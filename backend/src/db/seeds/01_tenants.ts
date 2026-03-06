import type { Knex } from 'knex';

// ============================================================
// Seed 01 — 3 tenants để test isolation
//
// acme       → standard tier (shared pool, shared DB)
// globex     → standard tier
// initech    → VIP tier    (dedicated pool 30 conns, shared DB)
//
// Cách test RLS sau khi seed:
//   SET app.tenant_id = '<acme-id>';
//   SELECT * FROM users;   -- chỉ thấy user của acme
//   SELECT * FROM users;   -- (không SET) → 0 rows
// ============================================================

export async function seed(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // TRUNCATE bypass RLS — an toàn để reset data trong dev
    await trx.raw(
      'TRUNCATE TABLE role_permissions, user_roles, permissions, roles, users, tenants CASCADE'
    );

    // ── Tenants ──────────────────────────────────────────────
    const [acme, globex, initech] = await trx('tenants')
      .insert([
        {
          name: 'Acme Corporation',
          subdomain: 'acme',
          tier: 'standard',
          config: JSON.stringify({
            plugins: ['customer-data', 'customer-care'],
            cors_origins: ['http://acme.localhost:3001'],
            max_users: 50,
          }),
        },
        {
          name: 'Globex Inc',
          subdomain: 'globex',
          tier: 'standard',
          config: JSON.stringify({
            plugins: ['customer-data', 'analytics'],
            cors_origins: ['http://globex.localhost:3001'],
            max_users: 100,
          }),
        },
        {
          name: 'Initech Enterprise',
          subdomain: 'initech',
          tier: 'vip',
          // VIP dùng dedicated pool nhưng vẫn shared DB trong phase 1
          db_url: null,
          config: JSON.stringify({
            plugins: ['customer-data', 'customer-care', 'analytics', 'automation', 'marketing'],
            cors_origins: ['http://initech.localhost:3001'],
            max_users: 500,
            vip_pool_size: 30,
          }),
        },
      ])
      .returning('*');

    // ── Permissions (global — không có tenant_id) ─────────────
    const permissionNames = [
      { name: 'customers:read',    description: 'Xem danh sách và chi tiết khách hàng' },
      { name: 'customers:write',   description: 'Tạo và sửa khách hàng' },
      { name: 'customers:delete',  description: 'Xóa khách hàng' },
      { name: 'deals:read',        description: 'Xem deals' },
      { name: 'deals:write',       description: 'Tạo và sửa deals' },
      { name: 'analytics:view',    description: 'Xem báo cáo và dashboard' },
      { name: 'plugins:manage',    description: 'Enable/disable plugin cho tenant' },
      { name: 'users:manage',      description: 'Quản lý user và role trong tenant' },
    ];

    const permissions = await trx('permissions')
      .insert(permissionNames)
      .returning('*');

    const permMap = Object.fromEntries(permissions.map((p) => [p.name, p.id]));

    // ── Helper: seed roles + users cho một tenant ─────────────
    async function seedTenant(
      tenant: { id: string; name: string; subdomain: string }
    ) {
      // SET LOCAL chỉ có hiệu lực trong transaction hiện tại
      // → RLS WITH CHECK pass vì tenant_id khớp với session var
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [tenant.id]);

      // Roles
      const [adminRole, managerRole, agentRole] = await trx('roles')
        .insert([
          {
            tenant_id: tenant.id,
            name: 'admin',
            description: 'Full access — quản trị toàn bộ tenant',
          },
          {
            tenant_id: tenant.id,
            name: 'manager',
            description: 'Xem tất cả, sửa deals và customers',
          },
          {
            tenant_id: tenant.id,
            name: 'agent',
            description: 'Chỉ xem và sửa customers/deals được assign',
          },
        ])
        .returning('*');

      // Role → Permissions
      await trx('role_permissions').insert([
        // Admin: tất cả
        ...Object.values(permMap).map((pid) => ({
          role_id: adminRole.id,
          permission_id: pid,
        })),
        // Manager: mọi thứ trừ quản lý user
        { role_id: managerRole.id, permission_id: permMap['customers:read'] },
        { role_id: managerRole.id, permission_id: permMap['customers:write'] },
        { role_id: managerRole.id, permission_id: permMap['deals:read'] },
        { role_id: managerRole.id, permission_id: permMap['deals:write'] },
        { role_id: managerRole.id, permission_id: permMap['analytics:view'] },
        // Agent: chỉ read
        { role_id: agentRole.id, permission_id: permMap['customers:read'] },
        { role_id: agentRole.id, permission_id: permMap['deals:read'] },
      ]);

      // Users (password_hash là bcrypt của "password123" — placeholder cho dev)
      const PLACEHOLDER_HASH =
        '$2b$12$62NgubmgJpkVTY.H/RyuS.G85GPegNcn0KlD2q4v0isyVCiTz5poS';

      const [adminUser, managerUser, agentUser] = await trx('users')
        .insert([
          {
            tenant_id: tenant.id,
            email: `admin@${tenant.subdomain}.example.com`,
            password_hash: PLACEHOLDER_HASH,
            name: `Admin (${tenant.name})`,
          },
          {
            tenant_id: tenant.id,
            email: `manager@${tenant.subdomain}.example.com`,
            password_hash: PLACEHOLDER_HASH,
            name: `Manager (${tenant.name})`,
          },
          {
            tenant_id: tenant.id,
            email: `agent@${tenant.subdomain}.example.com`,
            password_hash: PLACEHOLDER_HASH,
            name: `Agent (${tenant.name})`,
          },
        ])
        .returning('*');

      // User → Roles
      await trx('user_roles').insert([
        { user_id: adminUser.id,   role_id: adminRole.id,   tenant_id: tenant.id },
        { user_id: managerUser.id, role_id: managerRole.id, tenant_id: tenant.id },
        { user_id: agentUser.id,   role_id: agentRole.id,   tenant_id: tenant.id },
      ]);
    }

    // Seed từng tenant trong cùng transaction
    await seedTenant(acme);
    await seedTenant(globex);
    await seedTenant(initech);

    // ── System tenant (admin console super-admin) ─────────────
    const [systemTenant] = await trx('tenants')
      .insert({
        name: 'CRM System',
        subdomain: 'system',
        tier: 'standard',
        config: JSON.stringify({ plugins: [], cors_origins: [], max_users: 5 }),
      })
      .returning('*');

    await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [systemTenant.id]);

    const ADMIN_HASH = '$2b$12$62NgubmgJpkVTY.H/RyuS.G85GPegNcn0KlD2q4v0isyVCiTz5poS'; // admin123

    const [superAdminRole] = await trx('roles')
      .insert({
        tenant_id: systemTenant.id,
        name: 'super_admin',
        description: 'CRM system super administrator',
      })
      .returning('*');

    const [adminUser] = await trx('users')
      .insert({
        tenant_id: systemTenant.id,
        email: 'admin@crm.dev',
        password_hash: ADMIN_HASH,
        name: 'System Admin',
      })
      .returning('*');

    await trx('user_roles').insert({
      user_id: adminUser.id,
      role_id: superAdminRole.id,
      tenant_id: systemTenant.id,
    });
  });

  console.log('✓  Seed complete: acme (standard), globex (standard), initech (vip)');
  console.log('   Users: admin / manager / agent @ <subdomain>.example.com');
  console.log('   Password (dev only): password123');
  console.log('   Admin console: admin@crm.dev / admin123');
}

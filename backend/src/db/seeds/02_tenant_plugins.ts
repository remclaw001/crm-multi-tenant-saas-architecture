import type { Knex } from 'knex';

// ============================================================
// Seed 02 — tenant_plugins
//
// Enable all 5 built-in plugins for every seeded tenant.
// Reads tenant IDs dynamically from the tenants table so this
// seed works regardless of UUID generation.
//
// Plugin names must match PluginManifest.name constants in
// backend/src/plugins/manifest/built-in-manifests.ts
// ============================================================

const BUILT_IN_PLUGINS = [
  'customer-data',
  'customer-care',
  'analytics',
  'automation',
  'marketing',
] as const;

interface TenantRow {
  id: string;
}

export async function seed(knex: Knex): Promise<void> {
  // Clean existing entries first (idempotent re-run)
  await knex('tenant_plugins').del();

  // Load all tenants — no tenant_id filter needed (no RLS on tenants table)
  const tenants = await knex<TenantRow>('tenants').select('id');

  if (tenants.length === 0) {
    console.warn('⚠  No tenants found — run seed 01_tenants.ts first');
    return;
  }

  const rows = tenants.flatMap((tenant) =>
    BUILT_IN_PLUGINS.map((plugin_name) => ({
      tenant_id: tenant.id,
      plugin_name,
      config: JSON.stringify({}),
      is_enabled: true,
    }))
  );

  await knex('tenant_plugins').insert(rows);

  console.log(
    `✓  Seed complete: enabled ${BUILT_IN_PLUGINS.length} plugins × ${tenants.length} tenants = ${rows.length} rows`
  );
}

import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { TenantContext } from '../../../dal/context/TenantContext';

export interface TenantUserRow {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  list(): Promise<TenantUserRow[]> {
    const tenantId = TenantContext.requireTenantId();
    return this.knex<TenantUserRow>('users')
      .select('id', 'name', 'email')
      .where('tenant_id', tenantId);
  }
}

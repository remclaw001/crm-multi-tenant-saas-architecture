import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';

export interface TenantUserRow {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  list(): Promise<TenantUserRow[]> {
    // RLS + QueryInterceptor scope this to the current tenant automatically.
    // Never add WHERE tenant_id manually — QueryInterceptor handles it.
    return this.knex<TenantUserRow>('users').select('id', 'name', 'email');
  }
}

// ============================================================
// CustomerDataCore — contact management plugin core
//
// Stateless singleton. Domain methods receive IExecutionContext
// and use ctx.db.db() for tenant-scoped queries (RLS enforced).
//
// Self-registers with PluginRegistryService via OnModuleInit.
// ============================================================
import { Injectable, OnModuleInit } from '@nestjs/common';
import { CUSTOMER_DATA_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

export interface Contact {
  id: string;
  email: string;
  name: string;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
export class CustomerDataCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = CUSTOMER_DATA_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * List contacts for the current tenant (RLS-scoped).
   * Queries the existing users table — contacts are users in the CRM model.
   */
  async listContacts(ctx: IExecutionContext): Promise<Contact[]> {
    return ctx.db
      .db('users')
      .select('id', 'email', 'name', 'is_active', 'created_at')
      .where({ is_active: true })
      .orderBy('created_at', 'desc')
      .limit(50) as Promise<Contact[]>;
  }

  /**
   * Get a single contact by ID.
   * Returns null if not found (RLS ensures cross-tenant isolation).
   */
  async getContact(ctx: IExecutionContext, id: string): Promise<Contact | null> {
    const row = await ctx.db
      .db('users')
      .select('id', 'email', 'name', 'is_active', 'created_at')
      .where({ id })
      .first();
    return row ?? null;
  }
}

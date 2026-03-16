// ============================================================
// CustomerDataCore — customer CRUD plugin core
//
// Stateless singleton. Domain methods receive IExecutionContext
// and use ctx.db.db() for tenant-scoped queries (RLS enforced).
//
// Self-registers with PluginRegistryService via OnModuleInit.
// Fires before/after hooks on customer.create via HookRegistryService.
// ============================================================
import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { CUSTOMER_DATA_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { HookRegistryService } from '../../hooks/hook-registry.service';
import { EventRegistryService } from '../../events/event-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  is_active?: boolean;
}

@Injectable()
export class CustomerDataCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = CUSTOMER_DATA_MANIFEST;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly hookRegistry: HookRegistryService,
    private readonly eventRegistry: EventRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.eventRegistry.register({
      name: 'customer.create',
      plugin: 'customer-data',
      description: 'Fired when a new customer is created',
      // Payload wrapped as { customer } — matches triggerContext shape in fireTriggerEvents
      schema: z.object({
        customer: z.object({
          id:      z.string().uuid(),
          name:    z.string(),
          email:   z.string().email().nullable(),
          phone:   z.string().nullable(),
          company: z.string().nullable(),
        }),
      }),
    });
  }

  async listCustomers(ctx: IExecutionContext): Promise<Customer[]> {
    return ctx.db
      .db('customers')
      .select('id', 'tenant_id', 'name', 'email', 'phone', 'company', 'is_active', 'created_at', 'updated_at')
      .where({ is_active: true })
      .orderBy('created_at', 'desc')
      .limit(100) as Promise<Customer[]>;
  }

  async getCustomer(ctx: IExecutionContext, id: string): Promise<Customer> {
    const row = await ctx.db
      .db('customers')
      .select('id', 'tenant_id', 'name', 'email', 'phone', 'company', 'is_active', 'created_at', 'updated_at')
      .where({ id })
      .first();
    if (!row) throw new ResourceNotFoundError('Customer', id);
    return row as Customer;
  }

  async createCustomer(ctx: IExecutionContext, input: CreateCustomerInput): Promise<Customer> {
    await this.hookRegistry.runBefore('customer.create', ctx, input);

    const [customer] = await ctx.db
      .db('customers')
      .insert({
        tenant_id: ctx.tenantId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        company: input.company ?? null,
      })
      .returning('*') as Customer[];

    await this.hookRegistry.runAfter('customer.create', ctx, customer);
    await this.eventRegistry.emit('customer.create', ctx, { customer });
    return customer;
  }

  async updateCustomer(ctx: IExecutionContext, id: string, input: UpdateCustomerInput): Promise<Customer> {
    const [updated] = await ctx.db
      .db('customers')
      .where({ id })
      .update({ ...input, updated_at: ctx.db.db.raw('NOW()') })
      .returning('*') as Customer[];

    if (!updated) throw new ResourceNotFoundError('Customer', id);
    return updated;
  }

  async deleteCustomer(ctx: IExecutionContext, id: string): Promise<void> {
    const [deleted] = await ctx.db
      .db('customers')
      .where({ id })
      .update({ is_active: false, updated_at: ctx.db.db.raw('NOW()') })
      .returning('id') as Array<{ id: string }>;

    if (!deleted) throw new ResourceNotFoundError('Customer', id);
  }
}

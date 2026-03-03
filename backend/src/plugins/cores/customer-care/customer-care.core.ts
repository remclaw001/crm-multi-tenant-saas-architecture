import { Injectable, OnModuleInit } from '@nestjs/common';
import { CUSTOMER_CARE_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface SupportCase {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCaseInput {
  customer_id: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface UpdateCaseInput {
  title?: string;
  description?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority?: 'low' | 'medium' | 'high';
  assigned_to?: string;
}

@Injectable()
export class CustomerCareCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = CUSTOMER_CARE_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCases(ctx: IExecutionContext): Promise<SupportCase[]> {
    return ctx.db
      .db('support_cases')
      .select('support_cases.*', 'customers.name as customer_name')
      .join('customers', 'support_cases.customer_id', 'customers.id')
      .orderBy('support_cases.created_at', 'desc') as Promise<SupportCase[]>;
  }

  async getCase(ctx: IExecutionContext, id: string): Promise<SupportCase> {
    const row = await ctx.db
      .db('support_cases')
      .where({ id })
      .first();
    if (!row) throw new ResourceNotFoundError('SupportCase', id);
    return row as SupportCase;
  }

  async createCase(ctx: IExecutionContext, input: CreateCaseInput): Promise<SupportCase> {
    const customer = await ctx.db.db('customers').where({ id: input.customer_id }).first();
    if (!customer) throw new ResourceNotFoundError('Customer', input.customer_id);

    const [newCase] = await ctx.db
      .db('support_cases')
      .insert({
        customer_id: input.customer_id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'medium',
      })
      .returning('*') as SupportCase[];
    return newCase;
  }

  async updateCase(
    ctx: IExecutionContext,
    id: string,
    input: UpdateCaseInput,
  ): Promise<SupportCase> {
    const patch: Record<string, unknown> = {
      ...input,
      updated_at: ctx.db.db.raw('NOW()'),
    };
    // When resolving, set resolved_at timestamp
    if (input.status === 'resolved') {
      patch.resolved_at = ctx.db.db.raw('NOW()');
    }

    const [updated] = await ctx.db
      .db('support_cases')
      .where({ id })
      .update(patch)
      .returning('*') as SupportCase[];

    if (!updated) throw new ResourceNotFoundError('SupportCase', id);
    return updated;
  }

  async deleteCase(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db
      .db('support_cases')
      .where({ id })
      .del();
    if (count === 0) throw new ResourceNotFoundError('SupportCase', id);
  }
}

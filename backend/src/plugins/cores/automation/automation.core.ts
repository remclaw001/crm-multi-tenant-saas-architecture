import { Injectable, OnModuleInit } from '@nestjs/common';
import { AUTOMATION_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { HookRegistryService } from '../../hooks/hook-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  name: string;
  event_type: string;
  conditions: Record<string, unknown>;
  actions: unknown[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTriggerInput {
  name: string;
  event_type: string;
  conditions?: Record<string, unknown>;
  actions?: unknown[];
  is_active?: boolean;
}

export interface UpdateTriggerInput {
  name?: string;
  event_type?: string;
  conditions?: Record<string, unknown>;
  actions?: unknown[];
  is_active?: boolean;
}

@Injectable()
export class AutomationCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = AUTOMATION_MANIFEST;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly hookRegistry: HookRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);

    // Register before:customer.create hook (priority=5, runs before customer-care's after hook)
    this.hookRegistry.register(
      'automation',
      { event: 'customer.create', type: 'before', priority: 5 },
      async (_ctx, _data) => {
        // Phase 5: no-op. Phase 7+ will inspect active triggers and apply matching conditions.
      },
    );
  }

  async listTriggers(ctx: IExecutionContext): Promise<AutomationTrigger[]> {
    return ctx.db
      .db('automation_triggers')
      .select('*')
      .orderBy('created_at', 'desc') as Promise<AutomationTrigger[]>;
  }

  async getTrigger(ctx: IExecutionContext, id: string): Promise<AutomationTrigger> {
    const row = await ctx.db
      .db('automation_triggers')
      .where({ id })
      .first();
    if (!row) throw new ResourceNotFoundError('AutomationTrigger', id);
    return row as AutomationTrigger;
  }

  async createTrigger(ctx: IExecutionContext, input: CreateTriggerInput): Promise<AutomationTrigger> {
    const [trigger] = await ctx.db
      .db('automation_triggers')
      .insert({
        name: input.name,
        event_type: input.event_type,
        conditions: input.conditions ?? {},
        actions: input.actions ?? [],
        is_active: input.is_active ?? true,
      })
      .returning('*') as AutomationTrigger[];
    return trigger;
  }

  async updateTrigger(
    ctx: IExecutionContext,
    id: string,
    input: UpdateTriggerInput,
  ): Promise<AutomationTrigger> {
    const [updated] = await ctx.db
      .db('automation_triggers')
      .where({ id })
      .update({ ...input, updated_at: ctx.db.db.raw('NOW()') })
      .returning('*') as AutomationTrigger[];
    if (!updated) throw new ResourceNotFoundError('AutomationTrigger', id);
    return updated;
  }

  async deleteTrigger(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db.db('automation_triggers').where({ id }).del();
    if (count === 0) throw new ResourceNotFoundError('AutomationTrigger', id);
  }
}

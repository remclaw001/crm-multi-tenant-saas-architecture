import { Injectable, OnModuleInit } from '@nestjs/common';
import { AUTOMATION_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { HookRegistryService } from '../../hooks/hook-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';
import type { StoredAction } from './types/stored-action.types';

export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  name: string;
  event_type: string;
  conditions: Record<string, unknown>;
  actions: StoredAction[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTriggerInput {
  name: string;
  event_type: string;
  conditions?: Record<string, unknown>;
  actions?: StoredAction[];
  is_active?: boolean;
}

export interface UpdateTriggerInput {
  name?: string;
  event_type?: string;
  conditions?: Record<string, unknown>;
  actions?: StoredAction[];
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

    // Register after:customer.create hook (priority=20)
    this.hookRegistry.register(
      'automation',
      { event: 'customer.create', type: 'after', priority: 20 },
      async (ctx: IExecutionContext, data: unknown) => {
        const customer = data as Record<string, unknown>;
        await this.fireTriggerEvents(ctx, 'customer.create', { customer });
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
        tenant_id: ctx.tenantId,
        name: input.name,
        event_type: input.event_type,
        conditions: JSON.stringify(input.conditions ?? {}),
        actions: JSON.stringify(input.actions ?? []),
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
    const patch: Record<string, unknown> = { ...input, updated_at: ctx.db.db.raw('NOW()') };
    if (input.conditions !== undefined) patch.conditions = JSON.stringify(input.conditions);
    if (input.actions !== undefined) patch.actions = JSON.stringify(input.actions);
    const [updated] = await ctx.db
      .db('automation_triggers')
      .where({ id })
      .update(patch)
      .returning('*') as AutomationTrigger[];
    if (!updated) throw new ResourceNotFoundError('AutomationTrigger', id);
    return updated;
  }

  async deleteTrigger(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db.db('automation_triggers').where({ id }).del();
    if (count === 0) throw new ResourceNotFoundError('AutomationTrigger', id);
  }

  async fireTriggerEvents(
    ctx: IExecutionContext,
    eventType: string,
    triggerContext: Record<string, unknown>,
  ): Promise<void> {
    const triggers = await ctx.db
      .db('automation_triggers')
      .select('*')
      .where({ event_type: eventType, is_active: true })
      .orderBy('created_at', 'asc') as AutomationTrigger[];

    const rows: Record<string, unknown>[] = [];

    for (const trigger of triggers) {
      if (!this.evaluateConditions(trigger.conditions, triggerContext)) continue;
      const actions = trigger.actions ?? [];
      if (actions.length === 0) continue;

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        rows.push({
          tenant_id: ctx.tenantId,
          trigger_id: trigger.id,
          action_index: i,
          action_type: action.type,
          action_params: JSON.stringify(action.params),
          trigger_context: JSON.stringify(triggerContext),
          status: 'pending',
        });
      }
    }

    if (rows.length > 0) {
      await ctx.db.db('automation_action_events').insert(rows);
    }
  }

  evaluateConditions(
    conditions: Record<string, unknown>,
    triggerContext: Record<string, unknown>,
  ): boolean {
    interface ConditionRule { field: string; op: string; value?: string; }
    const rules = (conditions?.and as ConditionRule[] | undefined) ?? [];
    if (rules.length === 0) return true;

    const customer = (triggerContext.customer as Record<string, unknown>) ?? {};

    for (const rule of rules) {
      const fieldValue = String(customer[rule.field] ?? '');
      const ruleValue = rule.value ?? '';

      switch (rule.op) {
        case 'equals':       if (fieldValue !== ruleValue) return false; break;
        case 'not_equals':   if (fieldValue === ruleValue) return false; break;
        case 'contains':     if (!fieldValue.includes(ruleValue)) return false; break;
        case 'starts_with':  if (!fieldValue.startsWith(ruleValue)) return false; break;
        case 'is_empty':     if (fieldValue.trim() !== '') return false; break;
        case 'is_not_empty': if (fieldValue.trim() === '') return false; break;
        default:             break;
      }
    }
    return true;
  }
}

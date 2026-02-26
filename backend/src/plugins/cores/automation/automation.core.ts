// ============================================================
// AutomationCore — workflow automation plugin core
//
// Phase 5 placeholder — demonstrates ctx usage.
// A triggers table will be added in Phase 6.
// ============================================================
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AUTOMATION_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

export interface Trigger {
  id: string;
  name: string;
  event: string;
  condition: string;
  action: string;
  isActive: boolean;
  tenantId: string;
  createdBy: string;
}

export interface CreateTriggerInput {
  name: string;
  event: string;
  condition?: string;
  action: string;
}

@Injectable()
export class AutomationCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = AUTOMATION_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listTriggers(ctx: IExecutionContext): Promise<Trigger[]> {
    return [
      {
        id: 'trigger-placeholder-001',
        name: 'New contact welcome email',
        event: 'contact.create',
        condition: 'contact.is_active == true',
        action: 'send_email:welcome_template',
        isActive: true,
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
      },
    ];
  }

  async createTrigger(
    ctx: IExecutionContext,
    input: CreateTriggerInput,
  ): Promise<Trigger> {
    return {
      id: `trigger-${Date.now()}`,
      name: input.name,
      event: input.event,
      condition: input.condition ?? 'true',
      action: input.action,
      isActive: true,
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
    };
  }
}

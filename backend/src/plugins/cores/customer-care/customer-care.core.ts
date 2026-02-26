// ============================================================
// CustomerCareCore — support case management plugin core
//
// Phase 5 implementation: structured placeholder using ctx.
// No dedicated cases table yet — demonstrates correct ctx usage
// and ExecutionContext-driven patterns for Phase 6.
// ============================================================
import { Injectable, OnModuleInit } from '@nestjs/common';
import { CUSTOMER_CARE_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

export interface SupportCase {
  id: string;
  subject: string;
  status: 'open' | 'in-progress' | 'resolved';
  tenantId: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateCaseInput {
  subject: string;
  description?: string;
}

@Injectable()
export class CustomerCareCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = CUSTOMER_CARE_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCases(ctx: IExecutionContext): Promise<SupportCase[]> {
    // Phase 5 placeholder — cases table will be added in Phase 6
    // ctx.db and ctx.cache are available and scoped to ctx.tenantId
    return [
      {
        id: 'case-placeholder-001',
        subject: 'Example support case',
        status: 'open',
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  async createCase(
    ctx: IExecutionContext,
    input: CreateCaseInput,
  ): Promise<SupportCase> {
    return {
      id: `case-${Date.now()}`,
      subject: input.subject,
      status: 'open',
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
    };
  }
}

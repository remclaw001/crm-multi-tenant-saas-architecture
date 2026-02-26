// ============================================================
// MarketingCore — campaign and email marketing plugin core
//
// Phase 5 placeholder — demonstrates ctx usage.
// A campaigns table will be added in Phase 6.
// ============================================================
import { Injectable, OnModuleInit } from '@nestjs/common';
import { MARKETING_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

export interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  subject: string;
  tenantId: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateCampaignInput {
  name: string;
  subject: string;
  templateId?: string;
}

@Injectable()
export class MarketingCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = MARKETING_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCampaigns(ctx: IExecutionContext): Promise<Campaign[]> {
    return [
      {
        id: 'campaign-placeholder-001',
        name: 'Q1 2026 Outreach',
        status: 'active',
        subject: 'New product launch announcement',
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  async createCampaign(
    ctx: IExecutionContext,
    input: CreateCampaignInput,
  ): Promise<Campaign> {
    return {
      id: `campaign-${Date.now()}`,
      name: input.name,
      status: 'draft',
      subject: input.subject,
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
    };
  }
}

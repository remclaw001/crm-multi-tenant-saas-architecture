import { Injectable, OnModuleInit } from '@nestjs/common';
import { MARKETING_MANIFEST } from '../../manifest/built-in-manifests';
import type { IPluginCore } from '../../interfaces/plugin-core.interface';
import type { PluginManifest } from '../../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../../interfaces/execution-context.interface';
import { PluginRegistryService } from '../../registry/plugin-registry.service';
import { ResourceNotFoundError } from '../../../common/errors/domain.errors';

export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  campaign_type: 'email' | 'sms';
  target_count: number;
  sent_count: number;
  scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCampaignInput {
  name: string;
  campaign_type?: 'email' | 'sms';
  scheduled_at?: string;
}

export interface UpdateCampaignInput {
  name?: string;
  status?: 'draft' | 'active' | 'paused' | 'completed';
  target_count?: number;
  scheduled_at?: string | null;
}

@Injectable()
export class MarketingCore implements IPluginCore, OnModuleInit {
  readonly manifest: PluginManifest = MARKETING_MANIFEST;

  constructor(private readonly registry: PluginRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listCampaigns(ctx: IExecutionContext): Promise<Campaign[]> {
    return ctx.db
      .db('marketing_campaigns')
      .select('*')
      .orderBy('created_at', 'desc') as Promise<Campaign[]>;
  }

  async getCampaign(ctx: IExecutionContext, id: string): Promise<Campaign> {
    const row = await ctx.db.db('marketing_campaigns').where({ id }).first();
    if (!row) throw new ResourceNotFoundError('Campaign', id);
    return row as Campaign;
  }

  async createCampaign(ctx: IExecutionContext, input: CreateCampaignInput): Promise<Campaign> {
    const [campaign] = await ctx.db
      .db('marketing_campaigns')
      .insert({
        tenant_id: ctx.tenantId,
        name: input.name,
        campaign_type: input.campaign_type ?? 'email',
        scheduled_at: input.scheduled_at ?? null,
      })
      .returning('*') as Campaign[];
    return campaign;
  }

  async updateCampaign(
    ctx: IExecutionContext,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<Campaign> {
    const [updated] = await ctx.db
      .db('marketing_campaigns')
      .where({ id })
      .update({ ...input, updated_at: ctx.db.db.raw('NOW()') })
      .returning('*') as Campaign[];
    if (!updated) throw new ResourceNotFoundError('Campaign', id);
    return updated;
  }

  async deleteCampaign(ctx: IExecutionContext, id: string): Promise<void> {
    const count = await ctx.db.db('marketing_campaigns').where({ id }).del();
    if (count === 0) throw new ResourceNotFoundError('Campaign', id);
  }
}

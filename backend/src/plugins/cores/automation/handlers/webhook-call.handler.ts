import { Injectable } from '@nestjs/common';
import type { CommandHandler, ActionCommandContext } from './command-handler.interface';
import { resolveParams } from '../template-engine';

interface WebhookCallParams {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  body?: string;
}

@Injectable()
export class WebhookCallHandler implements CommandHandler<WebhookCallParams> {
  readonly actionType = 'webhook.call';

  async execute(ctx: ActionCommandContext, params: WebhookCallParams): Promise<void> {
    const resolved = resolveParams(params as Record<string, unknown>, ctx.triggerContext) as WebhookCallParams;

    const options: RequestInit = {
      method: resolved.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (resolved.body !== undefined) {
      options.body = resolved.body;
    }

    const res = await fetch(resolved.url, options);
    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${res.statusText}`);
    }
  }
}

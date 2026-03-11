import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { DomainError } from '../../../../common/errors/domain.errors';
import type { CommandHandler, ActionCommandContext } from './command-handler.interface';
import { resolveTemplate } from '../template-engine';

interface CaseCreateParams {
  title: string;
  priority: 'low' | 'medium' | 'high';
  description?: string;
}

class ActionDomainError extends DomainError {
  constructor(message: string) {
    super(message, 422, 'ACTION_DOMAIN_ERROR');
  }
}

@Injectable()
export class CaseCreateHandler implements CommandHandler<CaseCreateParams> {
  readonly actionType = 'case.create';

  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  async execute(ctx: ActionCommandContext, params: CaseCreateParams): Promise<void> {
    const customerId = (ctx.triggerContext.customer as Record<string, unknown>)?.id as string;

    const customer = await this.knex('customers')
      .where({ id: customerId })
      .select('id', 'tenant_id')
      .first();

    if (!customer) {
      throw new ActionDomainError('Customer not found');
    }
    if (customer.tenant_id !== ctx.tenantId) {
      throw new ActionDomainError('Customer belongs to different tenant');
    }

    const title = resolveTemplate(params.title, ctx.triggerContext);
    const description = params.description
      ? resolveTemplate(params.description, ctx.triggerContext)
      : undefined;

    await this.knex('support_cases')
      .insert({
        tenant_id: ctx.tenantId,
        customer_id: customerId,
        title,
        priority: params.priority,
        description: description ?? null,
        status: 'open',
      })
      .returning('id');
  }
}

import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { DomainError, ResourceNotFoundError } from '../../../../common/errors/domain.errors';
import type { CommandHandler, ActionCommandContext } from './command-handler.interface';
import { resolveTemplate } from '../template-engine';

const ALLOWED_FIELDS = ['name', 'email', 'phone', 'company'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

interface CustomerUpdateFieldParams {
  field: string;
  value: string;
}

@Injectable()
export class CustomerUpdateFieldHandler implements CommandHandler<CustomerUpdateFieldParams> {
  readonly actionType = 'customer.update_field';

  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  async execute(ctx: ActionCommandContext, params: CustomerUpdateFieldParams): Promise<void> {
    if (!(ALLOWED_FIELDS as readonly string[]).includes(params.field)) {
      throw new DomainError(`Invalid field: "${params.field}". Allowed: ${ALLOWED_FIELDS.join(', ')}`, 400, 'INVALID_ACTION_PARAMS');
    }

    const customerId = (ctx.triggerContext.customer as Record<string, unknown>)?.id as string;

    const customer = await this.knex('customers')
      .where({ id: customerId })
      .select('id', 'tenant_id')
      .first();

    if (!customer) {
      throw new ResourceNotFoundError('Customer', customerId);
    }
    if (customer.tenant_id !== ctx.tenantId) {
      throw new ResourceNotFoundError('Customer', customerId);
    }

    const resolved = resolveTemplate(params.value, ctx.triggerContext);
    await this.knex('customers')
      .where({ id: customerId })
      .update({ [params.field as AllowedField]: resolved, updated_at: this.knex.raw('NOW()') });
  }
}

import { Injectable, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import type { IExecutionContext } from '../interfaces/execution-context.interface';
import type { EventDefinition } from './event-definition.interface';
import { ResourceNotFoundError } from '../../common/errors/domain.errors';

const TTL_DAYS = 7;

@Injectable()
export class EventRegistryService {
  private readonly definitions = new Map<string, EventDefinition>();

  constructor(@Inject('KNEX_INSTANCE') private readonly knex: Knex) {}

  register(def: EventDefinition): void {
    this.definitions.set(def.name, def);
  }

  async emit(eventName: string, ctx: IExecutionContext, data: unknown): Promise<void> {
    const def = this.definitions.get(eventName);
    if (!def) throw new ResourceNotFoundError(`Unknown event: ${eventName}`);

    const payload = def.schema.parse(data);

    await this.knex('plugin_events').insert({
      tenant_id:  ctx.tenantId,
      event_name: eventName,
      plugin:     def.plugin,
      payload:    JSON.stringify(payload),
      status:     'pending',
      expires_at: this.knex.raw(`NOW() + INTERVAL '${TTL_DAYS} days'`),
    });
  }

  getDefinitions(): EventDefinition[] {
    return [...this.definitions.values()];
  }

  getDefinition(name: string): EventDefinition | undefined {
    return this.definitions.get(name);
  }
}

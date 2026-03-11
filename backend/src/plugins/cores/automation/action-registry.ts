import { Injectable } from '@nestjs/common';
import { PluginError } from '../../../common/errors/plugin.errors';
import type { CommandHandler } from './handlers/command-handler.interface';
import { getAvailableActions } from './action-catalog';
import type { ActionDefinition } from './action-catalog';

@Injectable()
export class ActionRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, CommandHandler<any>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(handler: CommandHandler<any>): void {
    this.handlers.set(handler.actionType, handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getHandler(type: string): CommandHandler<any> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new PluginError(`Unknown action type: "${type}"`, 400, 'UNKNOWN_ACTION_TYPE', 'automation');
    }
    return handler;
  }

  getAvailableFor(enabledPlugins: string[]): ActionDefinition[] {
    const available = getAvailableActions(enabledPlugins);
    return available.filter((def) => this.handlers.has(def.type));
  }
}

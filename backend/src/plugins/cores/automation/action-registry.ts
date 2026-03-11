import { Injectable } from '@nestjs/common';
import { PluginError } from '../../../common/errors/plugin.errors';
import type { CommandHandler } from './handlers/command-handler.interface';
import { getAvailableActions } from './action-catalog';
import type { ActionDefinition } from './action-catalog';

@Injectable()
export class ActionRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  register(handler: CommandHandler): void {
    this.handlers.set(handler.actionType, handler);
  }

  getHandler(type: string): CommandHandler {
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

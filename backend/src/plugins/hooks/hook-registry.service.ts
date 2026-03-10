// ============================================================
// HookRegistryService — before/after/filter hook execution
//
// Hooks are registered by plugin cores at OnModuleInit time.
// Each hook is keyed as "<type>:<event>" (e.g. "before:contact.create").
// Multiple handlers on the same key are sorted by priority ascending
// (lower number = higher priority = runs first).
//
// before hooks: run sequentially before main action, no return value
// after hooks:  run sequentially after main action, no return value
// filter hooks: run sequentially, each receives/returns transformed data
// ============================================================
import { Injectable } from '@nestjs/common';
import type { PluginHookDef } from '../interfaces/plugin-manifest.interface';
import type { IExecutionContext } from '../interfaces/execution-context.interface';

export type HookHandler = (
  ctx: IExecutionContext,
  data: unknown,
) => Promise<unknown>;

interface HookEntry {
  pluginName: string;
  def: PluginHookDef;
  handler: HookHandler;
}

@Injectable()
export class HookRegistryService {
  private readonly hooks = new Map<string, HookEntry[]>();

  register(pluginName: string, def: PluginHookDef, handler: HookHandler): void {
    const key = `${def.type}:${def.event}`;
    const entries = this.hooks.get(key) ?? [];
    entries.push({ pluginName, def, handler });
    // Sort ascending by priority — lower number runs first
    entries.sort((a, b) => a.def.priority - b.def.priority);
    this.hooks.set(key, entries);
  }

  async runBefore(
    event: string,
    ctx: IExecutionContext,
    data: unknown,
  ): Promise<void> {
    const entries = this.hooks.get(`before:${event}`) ?? [];
    for (const entry of entries) {
      if (ctx.enabledPlugins && !ctx.enabledPlugins.includes(entry.pluginName)) continue;
      await entry.handler(ctx, data);
    }
  }

  async runAfter(
    event: string,
    ctx: IExecutionContext,
    data: unknown,
  ): Promise<void> {
    const entries = this.hooks.get(`after:${event}`) ?? [];
    for (const entry of entries) {
      if (ctx.enabledPlugins && !ctx.enabledPlugins.includes(entry.pluginName)) continue;
      await entry.handler(ctx, data);
    }
  }

  async runFilter<T>(
    event: string,
    ctx: IExecutionContext,
    data: T,
  ): Promise<T> {
    const entries = this.hooks.get(`filter:${event}`) ?? [];
    let result: unknown = data;
    for (const entry of entries) {
      if (ctx.enabledPlugins && !ctx.enabledPlugins.includes(entry.pluginName)) continue;
      result = await entry.handler(ctx, result);
    }
    return result as T;
  }
}

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry } from '../action-registry';
import type { CommandHandler } from '../handlers/command-handler.interface';

function makeHandler(type: string): CommandHandler {
  return { actionType: type, execute: async () => {} };
}

describe('ActionRegistry', () => {
  let registry: ActionRegistry;

  beforeEach(() => {
    registry = new ActionRegistry();
  });

  it('getHandler returns registered handler', () => {
    registry.register(makeHandler('webhook.call'));
    const h = registry.getHandler('webhook.call');
    expect(h.actionType).toBe('webhook.call');
  });

  it('getHandler throws for unknown type', () => {
    expect(() => registry.getHandler('unknown.type')).toThrow();
  });

  it('getAvailableFor returns definitions filtered by enabled plugins', () => {
    registry.register(makeHandler('webhook.call'));
    registry.register(makeHandler('customer.update_field'));
    registry.register(makeHandler('case.create'));

    const defs = registry.getAvailableFor(['customer-data']);
    const types = defs.map((d) => d.type);
    expect(types).toContain('webhook.call');
    expect(types).toContain('customer.update_field');
    expect(types).not.toContain('case.create');
  });

  it('getAvailableFor with no plugins returns only no-requirement actions', () => {
    registry.register(makeHandler('webhook.call'));
    registry.register(makeHandler('customer.update_field'));
    const defs = registry.getAvailableFor([]);
    expect(defs.map((d) => d.type)).toEqual(['webhook.call']);
  });
});

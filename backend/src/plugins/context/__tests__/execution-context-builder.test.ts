import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEnabledPlugins = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['customer-data', 'automation']),
);
const mockKnex = vi.hoisted(() => ({} as any));
const mockCache = vi.hoisted(() => ({} as any));
const mockPool  = vi.hoisted(() => ({} as any));

import { ExecutionContextBuilder } from '../execution-context-builder.service';
import { PluginRegistryService } from '../../registry/plugin-registry.service';

describe('ExecutionContextBuilder.buildForWorker', () => {
  let builder: ExecutionContextBuilder;
  let registry: PluginRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = { getEnabledPlugins: mockGetEnabledPlugins } as unknown as PluginRegistryService;
    builder = new ExecutionContextBuilder(mockKnex, mockCache, mockPool, registry);
  });

  it('returns ExecutionContext with correct tenantId and tier', async () => {
    const ctx = await builder.buildForWorker('ten-1', 'premium', 'req-abc');
    expect(ctx.tenantId).toBe('ten-1');
    expect(ctx.tenantTier).toBe('premium');  // field is tenantTier, not tier
  });

  it('fetches enabledPlugins via PluginRegistryService', async () => {
    await builder.buildForWorker('ten-1', 'basic', 'req-abc');
    expect(mockGetEnabledPlugins).toHaveBeenCalledWith('ten-1', mockCache, mockPool);
  });

  it('sets enabledPlugins from registry result', async () => {
    const ctx = await builder.buildForWorker('ten-1', 'basic', 'req-abc');
    expect(ctx.enabledPlugins).toEqual(['customer-data', 'automation']);
  });
});

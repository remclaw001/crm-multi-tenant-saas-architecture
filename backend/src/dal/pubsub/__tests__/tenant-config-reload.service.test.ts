import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock ioredis before importing the service ──────────────
const mockOn        = vi.hoisted(() => vi.fn().mockReturnThis());
const mockSubscribe = vi.hoisted(() => vi.fn());
const mockDisconnect = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on:         mockOn,
    subscribe:  mockSubscribe,
    disconnect: mockDisconnect,
  })),
}));

vi.mock('../../../config/env', () => ({
  config: { REDIS_URL: 'redis://localhost:6379' },
}));

// ── Mock TenantQuotaEnforcer ───────────────────────────────
const mockUpdateCap = vi.hoisted(() => vi.fn());
vi.mock('../../pool/TenantQuotaEnforcer', () => ({
  TenantQuotaEnforcer: { updateCap: mockUpdateCap },
}));

import { TenantConfigReloadService, CONFIG_RELOAD_CHANNEL, CACHE_INVALIDATE_CHANNEL } from '../tenant-config-reload.service';

describe('TenantConfigReloadService', () => {
  let service: TenantConfigReloadService;

  /** Captures the 'message' handler registered via subscriber.on() */
  function getMessageHandler(): (channel: string, raw: string) => void {
    const call = mockOn.mock.calls.find(([event]) => event === 'message');
    if (!call) throw new Error('No message handler registered');
    return call[1] as (channel: string, raw: string) => void;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TenantConfigReloadService();
  });

  afterEach(() => {
    service.onApplicationShutdown();
  });

  it('subscribes to config channels on bootstrap', () => {
    service.onApplicationBootstrap();

    expect(mockSubscribe).toHaveBeenCalledWith(
      CONFIG_RELOAD_CHANNEL,
      CACHE_INVALIDATE_CHANNEL,
      expect.any(Function),
    );
  });

  it('calls TenantQuotaEnforcer.updateCap on crm:config:reload', () => {
    service.onApplicationBootstrap();

    const handler = getMessageHandler();
    handler(CONFIG_RELOAD_CHANNEL, JSON.stringify({ tenantId: 'tid-1', newTier: 'enterprise' }));

    expect(mockUpdateCap).toHaveBeenCalledWith('tid-1', 'enterprise');
  });

  it('does NOT call updateCap for crm:cache:invalidate messages', () => {
    service.onApplicationBootstrap();

    const handler = getMessageHandler();
    handler(CACHE_INVALIDATE_CHANNEL, JSON.stringify({ tenantId: 'tid-1', scope: 'tenant-context' }));

    expect(mockUpdateCap).not.toHaveBeenCalled();
  });

  it('ignores malformed JSON without throwing', () => {
    service.onApplicationBootstrap();

    const handler = getMessageHandler();
    expect(() => handler(CONFIG_RELOAD_CHANNEL, 'not-json')).not.toThrow();
    expect(mockUpdateCap).not.toHaveBeenCalled();
  });

  it('ignores reload message missing tenantId or newTier', () => {
    service.onApplicationBootstrap();

    const handler = getMessageHandler();
    handler(CONFIG_RELOAD_CHANNEL, JSON.stringify({ tenantId: 'tid-1' })); // missing newTier
    handler(CONFIG_RELOAD_CHANNEL, JSON.stringify({ newTier: 'basic' }));  // missing tenantId

    expect(mockUpdateCap).not.toHaveBeenCalled();
  });

  it('disconnects the subscriber on shutdown', () => {
    service.onApplicationBootstrap();
    service.onApplicationShutdown();

    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('is idempotent on repeated shutdowns', () => {
    service.onApplicationBootstrap();
    service.onApplicationShutdown();
    service.onApplicationShutdown(); // second call — subscriber already null

    expect(mockDisconnect).toHaveBeenCalledOnce();
  });
});

import { ServiceUnavailableException } from '@nestjs/common';

const TIER_CAPS: Record<string, number> = {
  basic:      10,
  standard:   10,  // legacy alias
  premium:    20,
  enterprise: 30,
  vip:        Infinity, // exempt — uses dedicated pool
};

const ACQUIRE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS   = 50;

interface Slot { current: number; max: number }

/**
 * Static per-tier connection cap enforcer.
 * Static (not @Injectable) so QueryInterceptor can import it directly.
 */
export class TenantQuotaEnforcer {
  private static readonly slots = new Map<string, Slot>();

  static register(tenantId: string, tier: string): void {
    const max = TIER_CAPS[tier] ?? 10;
    if (max === Infinity) return; // VIP exempt
    this.slots.set(tenantId, { current: 0, max });
  }

  /**
   * Synchronous acquire with optional timeout override (0 = throw immediately).
   * Throws immediately if timeoutMs === 0 and cap is reached.
   */
  static acquireSync(tenantId: string, timeoutMs = ACQUIRE_TIMEOUT_MS): void {
    const slot = this.slots.get(tenantId);
    if (!slot) return; // VIP/unregistered — pass through

    if (slot.current >= slot.max) {
      throw new ServiceUnavailableException(
        'DB connection cap reached for this tenant. Try again shortly.'
      );
    }
    slot.current++;
  }

  /** Async acquire with polling — use in production (QueryInterceptor). */
  static async acquire(tenantId: string): Promise<void> {
    const slot = this.slots.get(tenantId);
    if (!slot) return; // VIP/unregistered

    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

    while (slot.current >= slot.max) {
      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException(
          `DB connection cap reached (${slot.current}/${slot.max}) for tenant. Try again shortly.`
        );
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    slot.current++;
  }

  static release(tenantId: string): void {
    const slot = this.slots.get(tenantId);
    if (slot && slot.current > 0) slot.current--;
  }

  static updateCap(tenantId: string, tier: string): void {
    const newMax = TIER_CAPS[tier] ?? 10;
    if (newMax === Infinity) {
      this.slots.delete(tenantId); // VIP — exempt from now on
      return;
    }
    const slot = this.slots.get(tenantId);
    if (slot) {
      slot.max = newMax;
    } else {
      this.slots.set(tenantId, { current: 0, max: newMax });
    }
  }

  static deregister(tenantId: string): void {
    this.slots.delete(tenantId);
  }

  static isRegistered(tenantId: string): boolean {
    return this.slots.has(tenantId);
  }

  /** For tests only — clears all state. */
  static reset(): void {
    this.slots.clear();
  }
}

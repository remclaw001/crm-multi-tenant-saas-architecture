// ============================================================
// SandboxService — time-bound execution for built-in plugin cores
//
// Wraps trusted (built-in) plugin core method calls in Promise.race():
//   - fn() resolves  → returns result normally
//   - timeout fires  → rejects with GatewayTimeoutException (504)
//
// Default timeout: 5000ms (matches PluginResourceLimits.timeoutMs)
// VIP tenants receive a minimum effective timeout of 10000ms.
//
// Query limit (50/request) is now enforced by QueryInterceptor
// via QueryCounter.increment(true) — throws QueryLimitExceededError
// on the 51st DB connection acquire within a single request.
//
// For untrusted third-party plugin scripts requiring a full V8 isolate
// (separate heap, hard memory limit), see IsolatedSandboxService.
// ============================================================
import { Injectable, GatewayTimeoutException } from '@nestjs/common';
import { TenantContext } from '../../dal/context/TenantContext';

const VIP_MIN_TIMEOUT_MS = 10_000;

@Injectable()
export class SandboxService {
  async execute<T>(fn: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
    const tier = TenantContext.getTier();
    const effectiveTimeout =
      tier === 'vip' ? Math.max(timeoutMs, VIP_MIN_TIMEOUT_MS) : timeoutMs;

    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new GatewayTimeoutException('Plugin execution timeout')),
        effectiveTimeout,
      );
    });
    // Suppress unhandled-rejection noise when fn() wins the race.
    timeoutPromise.catch(() => undefined);

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }
}

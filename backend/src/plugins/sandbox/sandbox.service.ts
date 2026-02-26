// ============================================================
// SandboxService — time-bound execution for built-in plugin cores
//
// Wraps trusted (built-in) plugin core method calls in Promise.race():
//   - fn() resolves  → returns result normally
//   - timeout fires  → rejects with GatewayTimeoutException (504)
//
// Default timeout: 5000ms (matches PluginResourceLimits.timeoutMs)
//
// Query limit (50/request) is now enforced by QueryInterceptor
// via QueryCounter.increment(true) — throws QueryLimitExceededError
// on the 51st DB connection acquire within a single request.
//
// For untrusted third-party plugin scripts requiring a full V8 isolate
// (separate heap, hard memory limit), see IsolatedSandboxService.
// ============================================================
import { Injectable, GatewayTimeoutException } from '@nestjs/common';

@Injectable()
export class SandboxService {
  async execute<T>(fn: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new GatewayTimeoutException('Plugin execution timeout')),
          timeoutMs,
        ),
      ),
    ]);
  }
}

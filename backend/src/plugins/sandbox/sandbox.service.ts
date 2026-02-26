// ============================================================
// SandboxService — time-bound plugin execution
//
// Wraps plugin core method calls in Promise.race():
//   - fn() resolves  → returns result normally
//   - timeout fires  → rejects with GatewayTimeoutException (504)
//
// Default timeout: 5000ms (matches PluginResourceLimits.timeoutMs)
//
// QueryCounter (Phase 2) handles the query limit (50/request).
// Memory limit enforcement is deferred to Phase 6 OS-level cgroups.
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

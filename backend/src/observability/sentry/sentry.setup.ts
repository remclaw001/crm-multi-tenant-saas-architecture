// ============================================================
// sentry.setup.ts — Sentry / GlitchTip error tracking
//
// Khởi tạo Sentry trước khi NestJS bootstrap để capture mọi
// unhandled exception kể cả trong startup phase.
//
// Tích hợp với TenantContext (AsyncLocalStorage) để tự động
// đính kèm tenant_id và correlation_id vào mỗi error event,
// giúp debug cross-tenant issues nhanh hơn.
//
// Chỉ active khi SENTRY_DSN được set.
// Tương thích với GlitchTip (self-hosted Sentry alternative):
//   SENTRY_DSN=http://key@localhost:8000/1
// ============================================================
import { config } from '../../config/env';

// Lazy-loaded để tránh crash khi @sentry/node chưa được install
let _sentry: typeof import('@sentry/node') | null = null;

export function initSentry(): void {
  if (!config.SENTRY_DSN) {
    return; // Sentry disabled — không log để tránh noise
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sentry = require('@sentry/node') as typeof import('@sentry/node');

    _sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      // 10% sampling production để tiết kiệm quota; 100% dev/staging
      tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
      // Đính release version để Sentry nhóm errors theo version
      release: process.env['npm_package_version'],
      // Không gửi PII mặc định — chỉ gửi tenant_id + trace_id qua setTag
      sendDefaultPii: false,
    });

    console.info('[Sentry] Initialized — error tracking active');
  } catch (err) {
    // Warn nhưng không crash app nếu @sentry/node không available
    console.warn(
      '[Sentry] Failed to initialize:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Capture exception và đính tenant context vào Sentry scope.
 * No-op nếu SENTRY_DSN chưa được set hoặc init chưa chạy.
 *
 * @param exception  - Exception object để capture
 * @param ctx        - Context metadata (tenantId, traceId)
 */
export function captureException(
  exception: unknown,
  ctx?: { tenantId?: string; traceId?: string },
): void {
  if (!_sentry) return;

  _sentry.withScope((scope) => {
    if (ctx?.tenantId) scope.setTag('tenant_id', ctx.tenantId);
    if (ctx?.traceId) scope.setTag('trace_id', ctx.traceId);
    _sentry!.captureException(exception);
  });
}

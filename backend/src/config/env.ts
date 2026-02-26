import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database — shared pool
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(200),

  // Database — metadata pool (migrations, tenant lookup)
  DATABASE_METADATA_URL: z.string().min(1).optional(),
  DATABASE_METADATA_POOL_MAX: z.coerce.number().int().positive().default(20),

  // Cache
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Message broker
  RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL is required'),

  // App
  PORT: z.coerce.number().int().positive().default(3000),

  // ── JWT / Auth ─────────────────────────────────────────────
  JWT_JWKS_URI: z.string().url().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_SECRET_FALLBACK: z.string().min(32).optional(),
  JWT_AUDIENCE: z.string().optional(),

  // ── Rate limiting ──────────────────────────────────────────
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),

  // ── Logging (Phase 4) ──────────────────────────────────────
  // Pino log level
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ── OpenTelemetry (Phase 4) ────────────────────────────────
  // OTLP endpoint — Jaeger hoặc collector nhận gRPC/HTTP traces
  // e.g. http://localhost:4318/v1/traces
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  // Service name xuất hiện trên mọi span và log entry
  OTEL_SERVICE_NAME: z.string().default('crm-api'),

  // Tắt OTel hoàn toàn (dùng trong unit tests để tránh overhead)
  OTEL_DISABLED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),

  // ── Metrics (Phase 4) ─────────────────────────────────────
  // Interval cập nhật DB pool gauges (milliseconds)
  POOL_METRICS_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
});

const envWithJwtCheck = envSchema.refine(
  (data) => data.JWT_JWKS_URI !== undefined || data.JWT_SECRET_FALLBACK !== undefined,
  {
    message: 'Must set JWT_JWKS_URI (production) or JWT_SECRET_FALLBACK (dev/test)',
    path: ['JWT_JWKS_URI'],
  }
);

const result = envWithJwtCheck.safeParse(process.env);

if (!result.success) {
  console.error('\n❌  Invalid / missing environment variables:\n');
  const formatted = result.error.format();
  for (const [key, val] of Object.entries(formatted)) {
    if (key === '_errors') continue;
    const errors = (val as { _errors: string[] })._errors;
    if (errors.length) {
      console.error(`  ${key}: ${errors.join(', ')}`);
    }
  }
  console.error('\nCopy .env.example to .env and fill in all required values.\n');
  process.exit(1);
}

export const config = result.data;
export type Config = typeof config;

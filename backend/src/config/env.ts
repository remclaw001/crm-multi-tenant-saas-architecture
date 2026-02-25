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
  // JWKS endpoint của Keycloak (dùng cho production)
  // e.g. http://localhost:8080/realms/crm/protocol/openid-connect/certs
  JWT_JWKS_URI: z.string().url().optional(),

  // Expected issuer trong JWT claims
  // e.g. http://localhost:8080/realms/crm
  JWT_ISSUER: z.string().optional(),

  // Symmetric secret cho dev/test — dùng khi JWT_JWKS_URI không set
  // Phải set ít nhất một trong hai: JWT_JWKS_URI hoặc JWT_SECRET_FALLBACK
  JWT_SECRET_FALLBACK: z.string().min(32).optional(),

  // Expected audience (optional — Keycloak có thể include hoặc không)
  JWT_AUDIENCE: z.string().optional(),

  // ── Rate limiting ──────────────────────────────────────────
  // Số request tối đa trong cửa sổ THROTTLE_TTL_MS
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  // Cửa sổ rate limit tính bằng milliseconds
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
});

// Validation thêm: bắt buộc có ít nhất một trong JWKS_URI hoặc SECRET_FALLBACK
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

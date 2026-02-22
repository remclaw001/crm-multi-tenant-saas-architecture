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
});

const result = envSchema.safeParse(process.env);

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

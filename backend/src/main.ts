// ============================================================
// main.ts — NestJS bootstrap
//
// Khởi động ứng dụng với:
//   - Global validation pipe (class-validator)
//   - Global exception filter (RFC 7807 Problem Details)
//   - Graceful shutdown hooks
// ============================================================
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './gateway/filters/http-exception.filter';
import { config } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Tắt Express default logger — dùng logger của NestJS
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // ── Global pipes ──────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // Strip unknown properties
      forbidNonWhitelisted: false,
      transform: true,        // Auto-transform payloads to DTO classes
    })
  );

  // ── Global filters ────────────────────────────────────────
  // RFC 7807 Problem Details JSON response format
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Enable shutdown hooks ─────────────────────────────────
  // Cho phép NestJS cleanup (close DB pools, etc.) khi nhận SIGTERM
  app.enableShutdownHooks();

  await app.listen(config.PORT);
  console.log(`[NestJS] CRM API listening on http://0.0.0.0:${config.PORT}`);
  console.log(`[NestJS] Environment: ${config.NODE_ENV}`);
}

bootstrap().catch((err) => {
  console.error('[NestJS] Fatal startup error:', err);
  process.exit(1);
});

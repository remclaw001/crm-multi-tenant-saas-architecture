// ============================================================
// main.ts — NestJS bootstrap
//
// Import order quan trọng:
//   1. tracing.setup    ← MUST be first (OTel patches express/pg/ioredis)
//   2. reflect-metadata ← MUST be before NestJS decorators
//   3. NestFactory + App modules
// ============================================================

// ⚠️ FIRST IMPORT — OpenTelemetry phải patch modules trước khi NestJS load chúng
import './observability/tracing/tracing.setup';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './gateway/filters/http-exception.filter';
import { config } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // bufferLogs: true → buffer log output cho đến khi Pino logger sẵn sàng
    // Tránh mất log trong quá trình bootstrap
    bufferLogs: true,
  });

  // ── Replace NestJS logger với Pino ───────────────────────
  // Phải gọi sau NestFactory.create() để Logger provider đã sẵn sàng
  app.useLogger(app.get(Logger));

  // ── Global pipes ──────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    })
  );

  // ── Global filters ────────────────────────────────────────
  // RFC 7807 Problem Details JSON
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Enable shutdown hooks ─────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(config.PORT);
}

bootstrap().catch((err) => {
  console.error('[NestJS] Fatal startup error:', err);
  process.exit(1);
});

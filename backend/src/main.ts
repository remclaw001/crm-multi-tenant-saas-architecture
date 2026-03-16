// ============================================================
// main.ts — NestJS bootstrap
//
// Import order quan trọng:
//   1. tracing.setup    ← MUST be first (OTel patches express/pg/ioredis)
//   2. sentry.setup     ← Sentry init trước khi NestJS load modules
//   3. reflect-metadata ← MUST be before NestJS decorators
//   4. NestFactory + App modules
// ============================================================

// ⚠️ FIRST IMPORT — OpenTelemetry phải patch modules trước khi NestJS load chúng
import './observability/tracing/tracing.setup';

// ⚠️ SECOND IMPORT — Sentry init trước NestJS để capture bootstrap errors
import { initSentry } from './observability/sentry/sentry.setup';
initSentry();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './gateway/filters/http-exception.filter';
import { createBullBoardRouter } from './workers/bull-board/bull-board.setup';
import { QUEUE_EMAIL, QUEUE_WEBHOOK, QUEUE_PLUGIN_EVENTS } from './workers/bullmq/queue.constants';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { config } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // bufferLogs: true → buffer log output cho đến khi Pino logger sẵn sàng
    bufferLogs: true,
  });

  // ── Replace NestJS logger với Pino ───────────────────────
  app.useLogger(app.get(Logger));

  // ── Security headers (Helmet.js) ─────────────────────────
  // Bật CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  // Pass Mozilla Observatory scan ≥ B+
  //
  // NOTE: CORS được xử lý bởi TenantCorsMiddleware (gateway.module.ts)
  // KHÔNG gọi app.enableCors() — sẽ conflict với per-tenant CORS middleware.
  app.use(
    helmet({
      // Content-Security-Policy: restrict resource loading
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc:  ["'self'"],
          styleSrc:   ["'self'", "'unsafe-inline'"], // inline styles cho health page
          imgSrc:     ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc:    ["'self'"],
          objectSrc:  ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      // Strict-Transport-Security: enforce HTTPS 1 year + include subdomains
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },
      // X-Frame-Options: DENY (prevent clickjacking)
      frameguard: { action: 'deny' },
      // X-Content-Type-Options: nosniff
      noSniff: true,
      // X-XSS-Protection: disabled (modern browsers use CSP instead)
      xssFilter: false,
      // Referrer-Policy: no-referrer for privacy
      referrerPolicy: { policy: 'no-referrer' },
      // Permissions-Policy: restrict access to browser APIs
      permittedCrossDomainPolicies: false,
    }),
  );

  // ── Global pipes ──────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    })
  );

  // ── Global filters ────────────────────────────────────────
  // RFC 7807 Problem Details JSON + AppError hierarchy mapping + Sentry
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Bull Board queue monitoring UI ───────────────────────
  // Dev: http://localhost:<PORT>/admin/queues
  // Protected in production by adding auth middleware before this.
  const emailQueue        = app.get<Queue>(getQueueToken(QUEUE_EMAIL));
  const webhookQueue      = app.get<Queue>(getQueueToken(QUEUE_WEBHOOK));
  const pluginEventsQueue = app.get<Queue>(getQueueToken(QUEUE_PLUGIN_EVENTS));
  app.use('/admin/queues', createBullBoardRouter(emailQueue, webhookQueue, pluginEventsQueue));

  // ── Enable shutdown hooks ─────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(config.PORT);
}

bootstrap().catch((err) => {
  console.error('[NestJS] Fatal startup error:', err);
  process.exit(1);
});

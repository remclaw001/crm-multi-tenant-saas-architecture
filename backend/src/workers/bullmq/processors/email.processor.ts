// ============================================================
// EmailProcessor — BullMQ Worker for `email-notifications` queue.
//
// Dev mode (SMTP_HOST not set):
//   - Logs email contents to console (no real delivery).
//
// Production (SMTP_HOST set):
//   - Delivers via Nodemailer SMTP transport.
//
// Retry strategy (configured by NotificationConsumer):
//   - attempts: 5, backoff: exponential 2s
//   - Final failure → BullMQ failed set (inspectable via Bull Board)
// ============================================================
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { QUEUE_EMAIL } from '../queue.constants';
import { config }      from '../../../config/env';
import type { NotificationMessage } from '../../dto/notification-message.dto';

@Processor(QUEUE_EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger   = new Logger(EmailProcessor.name);
  private readonly transport: nodemailer.Transporter;

  constructor() {
    super();
    if (config.SMTP_HOST) {
      this.transport = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        auth: config.SMTP_USER
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
      });
    } else {
      // Dev: ethereal / console transport
      this.transport = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn('SMTP_HOST not set — emails will be logged to console');
    }
  }

  async process(job: Job<NotificationMessage>): Promise<void> {
    const { to, subject, body, tenantId, userId } = job.data;

    if (!config.SMTP_HOST) {
      // Dev mode: just log
      this.logger.debug(
        `[DEV] Email to=${to} subject="${subject ?? '(no subject)'}" ` +
        `tenantId=${tenantId} userId=${userId}`
      );
      return;
    }

    await this.transport.sendMail({
      from:    config.EMAIL_FROM,
      to,
      subject: subject ?? '(no subject)',
      text:    body,
    });

    this.logger.debug(`Email sent to=${to} tenantId=${tenantId}`);
  }
}

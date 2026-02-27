// ============================================================
// EmailProcessor unit tests
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted() ensures mock variables are initialised before vi.mock() hoisting
const mockSendMail = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ messageId: 'test-id' })
);

vi.mock('nodemailer', () => ({
  // covers both: `import nodemailer from 'nodemailer'` and `import * as nodemailer`
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
  },
  createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
}));

// Path is relative to this test file: src/workers/__tests__/ → ../../ → src/config/env
vi.mock('../../config/env', () => ({
  config: {
    SMTP_HOST:  'smtp.test.local',
    SMTP_PORT:  587,
    SMTP_USER:  'testuser',
    SMTP_PASS:  'testpass',
    EMAIL_FROM: 'noreply@test.com',
  },
}));

import { EmailProcessor } from '../bullmq/processors/email.processor';
import type { Job }       from 'bullmq';
import type { NotificationMessage } from '../dto/notification-message.dto';

function makeJob(data: NotificationMessage): Job<NotificationMessage> {
  return { data } as Job<NotificationMessage>;
}

describe('EmailProcessor', () => {
  let processor: EmailProcessor;

  beforeEach(() => {
    processor = new EmailProcessor();
    mockSendMail.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends email via nodemailer transport', async () => {
    const job = makeJob({
      tenantId: 't1', userId: 'u1', channel: 'email',
      to: 'user@example.com', subject: 'Hello', body: 'World',
    });

    await processor.process(job);

    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe('Hello');
    expect(call.text).toBe('World');
    expect(call.from).toBe('noreply@test.com');
  });

  it('uses "(no subject)" when subject is undefined', async () => {
    const job = makeJob({
      tenantId: 't1', userId: 'u1', channel: 'email',
      to: 'user@example.com', body: 'Body text',
    });

    await processor.process(job);

    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toBe('(no subject)');
  });

  it('propagates sendMail errors (BullMQ will retry)', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    const job = makeJob({
      tenantId: 't1', userId: 'u1', channel: 'email',
      to: 'user@example.com', body: 'test',
    });

    await expect(processor.process(job)).rejects.toThrow('SMTP connection refused');
  });
});

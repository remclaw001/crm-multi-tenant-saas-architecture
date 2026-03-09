import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPutObject = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockGetSignedUrl = vi.hoisted(() => vi.fn().mockResolvedValue('https://presigned-url'));
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [{ id: '1', tenant_id: 'tid', name: 'Test' }] }));
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockPutObject })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));
vi.mock('../../../../dal/pool/PoolRegistry', () => ({
  PoolRegistry: vi.fn().mockImplementation(() => ({
    acquireMetadataConnection: mockConnect,
  })),
}));

const mockPublishNotification = vi.hoisted(() => vi.fn());
vi.mock('../../../../workers/amqp/amqp-publisher.service', () => ({
  AmqpPublisher: vi.fn().mockImplementation(() => ({
    publishNotification: mockPublishNotification,
  })),
}));

import { DataExportProcessor } from '../data-export.processor';
import { PoolRegistry } from '../../../../dal/pool/PoolRegistry';
import { AmqpPublisher } from '../../../../workers/amqp/amqp-publisher.service';

describe('DataExportProcessor', () => {
  let processor: DataExportProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new DataExportProcessor(new PoolRegistry() as any, new AmqpPublisher() as any);
  });

  it('uploads JSON for each table and manifest, sends email notification', async () => {
    const job = {
      data: { tenantId: 'tid', tenantName: 'ACME', adminEmail: 'admin@acme.com', tier: 'basic' },
    } as any;

    await processor.process(job);

    // 4 tables + 1 manifest = 5 S3 puts
    expect(mockPutObject).toHaveBeenCalledTimes(5);
    expect(mockPublishNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@acme.com' })
    );
  });

  it('skips email when adminEmail is not provided', async () => {
    const job = { data: { tenantId: 'tid', tenantName: 'ACME', tier: 'basic' } } as any;
    await processor.process(job);
    expect(mockPublishNotification).not.toHaveBeenCalled();
  });
});

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { QUEUE_DATA_EXPORT } from '../queue.constants';
import { PoolRegistry } from '../../../dal/pool/PoolRegistry';
import { AmqpPublisher } from '../../amqp/amqp-publisher.service';
import { config } from '../../../config/env';

const PLUGIN_TABLES = ['customers', 'support_cases', 'automation_triggers', 'marketing_campaigns'];
const PRESIGN_EXPIRES_SECONDS = 90 * 24 * 3600; // 90 days

export interface DataExportJobData {
  tenantId: string;
  tenantName: string;
  adminEmail?: string;
  tier: string;
}

@Processor(QUEUE_DATA_EXPORT, { concurrency: 2 })
export class DataExportProcessor extends WorkerHost {
  private readonly logger = new Logger(DataExportProcessor.name);
  private readonly s3: S3Client;

  constructor(
    private readonly poolRegistry: PoolRegistry,
    private readonly amqp: AmqpPublisher,
  ) {
    super();
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY ?? 'crm',
        secretAccessKey: config.S3_SECRET_KEY ?? 'crm_secret_dev',
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  async process(job: Job<DataExportJobData>): Promise<void> {
    const { tenantId, tenantName, adminEmail, tier } = job.data;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = `${tenantId}/${timestamp}`;
    const bucket = config.S3_BUCKET_EXPORTS;

    this.logger.log(`[DataExport] Starting for tenant ${tenantId}`);

    const client = await this.poolRegistry.acquireMetadataConnection();
    const rowCounts: Record<string, number> = {};

    try {
      // Export each plugin table as JSON
      for (const table of PLUGIN_TABLES) {
        const { rows } = await client.query(
          `SELECT * FROM "${table}" WHERE tenant_id = $1`,
          [tenantId],
        );
        rowCounts[table] = rows.length;
        await this.s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${table}.json`,
          Body: JSON.stringify(rows, null, 2),
          ContentType: 'application/json',
        }));
      }

      // Export manifest
      const manifestKey = `${prefix}/manifest.json`;
      await this.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify({
          tenantId,
          tenantName,
          tables: PLUGIN_TABLES,
          rowCounts,
          exportedAt: new Date().toISOString(),
          tier,
        }),
        ContentType: 'application/json',
      }));

      this.logger.log(`[DataExport] Uploaded ${PLUGIN_TABLES.length} tables + manifest for ${tenantId}`);

      // Generate pre-signed download URL for manifest (90-day validity)
      const presignedUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: bucket, Key: manifestKey }),
        { expiresIn: PRESIGN_EXPIRES_SECONDS },
      );

      // Send email notification if admin email provided
      if (adminEmail) {
        this.amqp.publishNotification({
          tenantId,
          userId: 'system',
          channel: 'email',
          to: adminEmail,
          subject: `Your data export for "${tenantName}" is ready`,
          body: `Your tenant data has been exported and is available for download for 90 days:\n\n${presignedUrl}\n\nIncludes: ${PLUGIN_TABLES.join(', ')}`,
          metadata: { type: 'tenant.data_exported', tenantId, rowCounts },
        });
      }

      this.logger.log(`[DataExport] Completed for tenant ${tenantId}`);
    } finally {
      client.release();
    }
  }
}

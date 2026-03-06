// ============================================================
// AmqpService — RabbitMQ connection + channel management.
//
// Lifecycle:
//   onModuleInit     → connect + create shared confirmation channel
//   onModuleDestroy  → close gracefully (channel → connection)
//
// Consumers should call createChannel() to get a dedicated channel
// (one channel per consumer is amqplib best practice — each channel
// has its own prefetch and ack/nack flow control).
// ============================================================
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { config } from '../../config/env';

@Injectable()
export class AmqpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AmqpService.name);
  private connection: amqp.ChannelModel | null = null;
  private sharedChannel: amqp.Channel | null = null;

  private readyResolve!: () => void;
  /** Resolves once the connection and shared channel are established. */
  readonly ready: Promise<void> = new Promise((res) => { this.readyResolve = res; });

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.sharedChannel?.close();
    } catch { /* ignore */ }
    try {
      await this.connection?.close();
    } catch { /* ignore */ }
    this.logger.log('AMQP connection closed');
  }

  private async connect(): Promise<void> {
    this.connection = await amqp.connect(config.RABBITMQ_URL);
    this.connection.on('error', (err: Error) =>
      this.logger.error('AMQP connection error', err.message)
    );
    this.connection.on('close', () =>
      this.logger.warn('AMQP connection closed unexpectedly')
    );
    this.sharedChannel = await this.connection.createChannel();
    this.readyResolve();
    this.logger.log('AMQP connected');
  }

  /** Shared channel for publishing (not for consuming). */
  getChannel(): amqp.Channel {
    if (!this.sharedChannel) {
      throw new Error('AMQP channel not ready — module not yet initialised');
    }
    return this.sharedChannel;
  }

  /**
   * Create a dedicated channel for a consumer.
   * Each consumer should have its own channel for independent flow control.
   */
  async createChannel(): Promise<amqp.Channel> {
    if (!this.connection) {
      throw new Error('AMQP connection not ready');
    }
    return this.connection.createChannel();
  }
}

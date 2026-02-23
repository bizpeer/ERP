import amqp from 'amqplib';
import { ERPEvent } from '@erp/types';

export class MessageBus {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private readonly EXCHANGE = 'erp_events';

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (this.connection) return;

    try {
      this.connection = await amqp.connect(this.url);
      this.channel = await this.connection.createChannel();
      await this.channel.assertExchange(this.EXCHANGE, 'topic', { durable: true });
      
      this.connection.on('error', (err) => {
        console.error('RabbitMQ connection error:', err);
        this.connection = null;
      });
      
      console.log('Successfully connected to RabbitMQ');
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  async emit(event: ERPEvent): Promise<boolean> {
    if (!this.channel) {
      await this.connect();
    }

    const routingKey = event.type.toLowerCase().replace(/_/g, '.');
    const content = Buffer.from(JSON.stringify({
      ...event,
      timestamp: event.timestamp || new Date(),
    }));

    return this.channel!.publish(this.EXCHANGE, routingKey, content, {
      persistent: true,
      headers: {
        'x-tenant-id': event.tenantId,
        'x-company-id': event.companyId,
      },
    });
  }

  async subscribe(
    pattern: string,
    onMessage: (event: ERPEvent) => Promise<void>
  ): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }

    const q = await this.channel!.assertQueue('', { exclusive: true });
    await this.channel!.bindQueue(q.queue, this.EXCHANGE, pattern);

    await this.channel!.consume(q.queue, async (msg) => {
      if (msg) {
        try {
          const event = JSON.parse(msg.content.toString()) as ERPEvent;
          await onMessage(event);
          this.channel!.ack(msg);
        } catch (error) {
          console.error('Error processing message:', error);
          // Potential DLQ logic here
          this.channel!.nack(msg, false, false);
        }
      }
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}

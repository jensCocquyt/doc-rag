import {
  QueueClient,
  QueueServiceClient,
  ReceivedMessageItem,
} from '@azure/storage-queue';

export interface QueueConsumerOptions {
  connectionString: string;
  queueName: string;
  poisonQueueName: string;
  /** How long a received message stays invisible while being processed. */
  visibilityTimeoutSeconds: number;
  /** Delivery attempts before the message moves to the poison queue. */
  maxDequeueCount: number;
  /** Idle wait between empty polls. */
  pollIntervalMs: number;
  /**
   * Called once per delivery. Throwing marks the attempt failed: the message
   * is redelivered (with backoff) until maxDequeueCount, then moved to the
   * poison queue.
   */
  handler: (messageText: string, context: MessageContext) => Promise<void>;
  /** Called after a message is moved to the poison queue. */
  onPoison?: (messageText: string, error: unknown) => Promise<void>;
  /** Seconds until a failed message reappears; defaults to retryBackoffSeconds. */
  backoffSeconds?: (dequeueCount: number) => number;
  log?: (message: string) => void;
}

export interface MessageContext {
  /** 1-based delivery attempt (Azure dequeueCount). */
  dequeueCount: number;
}

/** Exponential backoff for redeliveries, capped at 5 minutes. */
export function retryBackoffSeconds(dequeueCount: number): number {
  return Math.min(30 * 2 ** Math.max(0, dequeueCount - 1), 300);
}

/**
 * Pull-based consumer for one Azure Storage queue with the reliability rules
 * from PLAN.md Phase 3: visibility renewal during long processing, retries
 * driven by dequeueCount, and a poison queue for messages that keep failing.
 * At-least-once delivery — handlers must be idempotent.
 */
export class QueueConsumer {
  private readonly queue: QueueClient;
  private readonly poisonQueue: QueueClient;
  private readonly options: QueueConsumerOptions;
  private readonly log: (message: string) => void;
  private running = false;
  private stopped: Promise<void> | undefined;

  constructor(options: QueueConsumerOptions) {
    const service = QueueServiceClient.fromConnectionString(
      options.connectionString,
    );
    this.queue = service.getQueueClient(options.queueName);
    this.poisonQueue = service.getQueueClient(options.poisonQueueName);
    this.options = options;
    this.log = options.log ?? (() => undefined);
  }

  /** Resolves when the consumer has stopped (after stop() is called). */
  async start(): Promise<void> {
    if (this.running) return this.stopped;
    this.running = true;
    await this.queue.createIfNotExists();
    await this.poisonQueue.createIfNotExists();
    this.stopped = this.pollLoop();
    return this.stopped;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopped;
  }

  /** Receives and processes at most one message; returns whether one was handled. */
  async pollOnce(): Promise<boolean> {
    const response = await this.queue.receiveMessages({
      numberOfMessages: 1,
      visibilityTimeout: this.options.visibilityTimeoutSeconds,
    });
    const message = response.receivedMessageItems[0];
    if (!message) return false;
    await this.process(message);
    return true;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      let handled = false;
      try {
        handled = await this.pollOnce();
      } catch (error) {
        this.log(
          `queue poll failed: ${error instanceof Error ? error.message : error}`,
        );
      }
      if (!handled && this.running) {
        await sleep(this.options.pollIntervalMs);
      }
    }
  }

  private async process(message: ReceivedMessageItem): Promise<void> {
    let popReceipt = message.popReceipt;
    // Renew visibility at half the timeout so long parses (large PDFs) are
    // not redelivered mid-processing.
    const renewIntervalMs =
      (this.options.visibilityTimeoutSeconds * 1000) / 2;
    let renewalFailed = false;
    const renewal = setInterval(() => {
      void this.queue
        .updateMessage(
          message.messageId,
          popReceipt,
          message.messageText,
          this.options.visibilityTimeoutSeconds,
        )
        .then((update) => {
          popReceipt = update.popReceipt ?? popReceipt;
        })
        .catch((error) => {
          renewalFailed = true;
          this.log(
            `visibility renewal failed: ${error instanceof Error ? error.message : error}`,
          );
        });
    }, renewIntervalMs);

    try {
      await this.options.handler(message.messageText, {
        dequeueCount: message.dequeueCount,
      });
      clearInterval(renewal);
      await this.queue.deleteMessage(message.messageId, popReceipt);
    } catch (error) {
      clearInterval(renewal);
      if (message.dequeueCount >= this.options.maxDequeueCount) {
        // Exhausted: park the payload for inspection, drop the original.
        await this.poisonQueue.sendMessage(message.messageText);
        await this.queue.deleteMessage(message.messageId, popReceipt);
        this.log(
          `message ${message.messageId} moved to poison queue after ${message.dequeueCount} attempts`,
        );
        await this.options.onPoison?.(message.messageText, error);
      } else if (!renewalFailed) {
        // Shorten the invisibility window to the backoff so the retry does
        // not wait out the full visibility timeout.
        const backoff =
          this.options.backoffSeconds ?? retryBackoffSeconds;
        await this.queue
          .updateMessage(
            message.messageId,
            popReceipt,
            message.messageText,
            backoff(message.dequeueCount),
          )
          .catch(() => undefined);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

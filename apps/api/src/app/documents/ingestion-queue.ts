import { Inject, Injectable } from '@nestjs/common';
import { QueueClient, QueueServiceClient } from '@azure/storage-queue';
import type { ApiEnv } from '@doc-rag/config';
import {
  encodeIngestionMessage,
  IngestionQueueMessage,
} from '@doc-rag/contracts';
import { API_ENV } from '../env.provider';

/**
 * API-side sender for the ingestion queue. The consuming side (worker,
 * visibility renewal, poison queue) arrives in Phase 3 as libs/queue; this
 * stays deliberately minimal until that second implementation exists.
 */
@Injectable()
export class IngestionQueueSender {
  private readonly queue: QueueClient;
  private queueReady: Promise<void> | undefined;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.queue = QueueServiceClient.fromConnectionString(
      env.AZURE_STORAGE_QUEUE_CONNECTION_STRING,
    ).getQueueClient(env.AZURE_STORAGE_QUEUE_INGESTION);
  }

  private async ensureQueue(): Promise<void> {
    if (!this.queueReady) {
      this.queueReady = this.queue
        .createIfNotExists()
        .then(() => undefined)
        .catch((error) => {
          this.queueReady = undefined;
          throw error;
        });
    }
    return this.queueReady;
  }

  async send(message: IngestionQueueMessage): Promise<void> {
    await this.ensureQueue();
    await this.queue.sendMessage(encodeIngestionMessage(message));
  }
}

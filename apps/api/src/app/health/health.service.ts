import { Inject, Injectable, Logger } from '@nestjs/common';
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { Client } from 'pg';
import type { ApiEnv } from '@doc-rag/config';
import type { HealthCheckState, HealthReport } from '@doc-rag/contracts';
import { API_ENV } from '../env.provider';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  async check(): Promise<HealthReport> {
    const [postgres, blobStorage, queueStorage] = await Promise.all([
      this.checkPostgres(),
      this.checkBlobStorage(),
      this.checkQueueStorage(),
    ]);
    const checks = { postgres, blobStorage, queueStorage };
    const status = Object.values(checks).every((state) => state === 'up')
      ? 'ok'
      : 'degraded';
    return { status, checks };
  }

  private async checkPostgres(): Promise<HealthCheckState> {
    const client = new Client({
      connectionString: this.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return 'up';
    } catch (error) {
      this.logCheckFailure('postgres', error);
      return 'down';
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async checkBlobStorage(): Promise<HealthCheckState> {
    try {
      const client = BlobServiceClient.fromConnectionString(
        this.env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
      );
      await client.getProperties();
      return 'up';
    } catch (error) {
      this.logCheckFailure('blobStorage', error);
      return 'down';
    }
  }

  private async checkQueueStorage(): Promise<HealthCheckState> {
    try {
      const client = QueueServiceClient.fromConnectionString(
        this.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING,
      );
      await client.getProperties();
      return 'up';
    } catch (error) {
      this.logCheckFailure('queueStorage', error);
      return 'down';
    }
  }

  private logCheckFailure(check: string, error: unknown): void {
    // Log the failure reason internally; the health response only exposes up/down.
    this.logger.warn(
      `Health check '${check}' failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

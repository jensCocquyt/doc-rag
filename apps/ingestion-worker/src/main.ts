import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { Client } from 'pg';
import { loadDotenv, loadWorkerEnv, WorkerEnv } from '@doc-rag/config';

// Phase 0 skeleton: validate configuration, prove connectivity to PostgreSQL,
// Blob Storage and Queue Storage, then idle with a heartbeat. Queue consumption
// arrives in Phase 3.

const HEARTBEAT_INTERVAL_MS = 30_000;

async function probeConnectivity(env: WorkerEnv): Promise<void> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log('[worker] postgres: up');
  } finally {
    await client.end().catch(() => undefined);
  }

  await BlobServiceClient.fromConnectionString(
    env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
  ).getProperties();
  console.log('[worker] blob storage: up');

  await QueueServiceClient.fromConnectionString(
    env.AZURE_STORAGE_QUEUE_CONNECTION_STRING,
  ).getProperties();
  console.log('[worker] queue storage: up');
}

async function main(): Promise<void> {
  loadDotenv();
  const env = loadWorkerEnv();
  console.log('[worker] configuration validated');
  await probeConnectivity(env);

  const heartbeat = setInterval(() => {
    console.log('[worker] heartbeat — waiting for ingestion work (Phase 3)');
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down`);
    clearInterval(heartbeat);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('[worker] started');
}

main().catch((error) => {
  console.error(
    '[worker] fatal:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});

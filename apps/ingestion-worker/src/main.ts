import { loadDotenv, loadWorkerEnv } from '@doc-rag/config';
import {
  createDatabase,
  createPool,
  DrizzleChunkRepository,
  DrizzleDocumentRepository,
  DrizzleDocumentVersionRepository,
  DrizzleIngestionJobRepository,
} from '@doc-rag/database';
import { QueueConsumer } from '@doc-rag/queue';
import { AzureBlobObjectStorage } from '@doc-rag/storage';
import {
  createEmbeddingService,
  createParserRegistry,
} from './app/create-services';
import { IngestionPipeline } from './app/ingestion-pipeline';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadWorkerEnv();
  console.log('[worker] configuration validated');

  const pool = createPool(env.DATABASE_URL);
  const db = createDatabase(pool);

  const pipeline = new IngestionPipeline({
    documents: new DrizzleDocumentRepository(db),
    versions: new DrizzleDocumentVersionRepository(db),
    jobs: new DrizzleIngestionJobRepository(db),
    chunks: new DrizzleChunkRepository(db),
    originals: new AzureBlobObjectStorage({
      connectionString: env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
      containerName: env.AZURE_STORAGE_BLOB_CONTAINER_ORIGINALS,
    }),
    artifacts: new AzureBlobObjectStorage({
      connectionString: env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
      containerName: env.AZURE_STORAGE_BLOB_CONTAINER_ARTIFACTS,
    }),
    parsers: createParserRegistry(),
    embeddings: createEmbeddingService(env),
    options: {
      maxPages: env.MAX_PDF_PAGES,
      maxFileSizeBytes: env.MAX_FILE_SIZE_BYTES,
      chunkTargetTokens: env.CHUNK_TARGET_TOKENS,
      chunkOverlapTokens: env.CHUNK_OVERLAP_TOKENS,
    },
    log: (message) => console.log(`[worker] ${message}`),
  });

  const consumer = new QueueConsumer({
    connectionString: env.AZURE_STORAGE_QUEUE_CONNECTION_STRING,
    queueName: env.AZURE_STORAGE_QUEUE_INGESTION,
    poisonQueueName: env.AZURE_STORAGE_QUEUE_POISON,
    visibilityTimeoutSeconds: env.QUEUE_VISIBILITY_TIMEOUT_SECONDS,
    maxDequeueCount: env.QUEUE_MAX_DEQUEUE_COUNT,
    pollIntervalMs: env.QUEUE_POLL_INTERVAL_MS,
    handler: (text) => pipeline.handleMessage(text),
    onPoison: (text) => pipeline.handlePoison(text),
    log: (message) => console.log(`[worker] ${message}`),
  });

  const shutdown = (signal: string): void => {
    console.log(`[worker] received ${signal}, finishing in-flight work`);
    void consumer
      .stop()
      .then(() => pool.end())
      .then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log(
    `[worker] consuming '${env.AZURE_STORAGE_QUEUE_INGESTION}' (poison: '${env.AZURE_STORAGE_QUEUE_POISON}')`,
  );
  await consumer.start();
}

main().catch((error) => {
  console.error(
    '[worker] fatal:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});

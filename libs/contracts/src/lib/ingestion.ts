import { z } from 'zod';

/**
 * The message the API enqueues after storage verification and the worker
 * dequeues in the ingestion phase. IDs only — the worker loads current state
 * from PostgreSQL, so a stale or replayed message cannot carry stale data.
 */
export const ingestionQueueMessageSchema = z.object({
  type: z.literal('ingest-document-version'),
  jobId: z.uuid(),
  tenantId: z.uuid(),
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
});
export type IngestionQueueMessage = z.infer<typeof ingestionQueueMessageSchema>;

/**
 * Queue payloads are base64(JSON): Azure tooling (portal, KEDA samples)
 * assumes base64-safe message text, and @azure/storage-queue does not encode
 * for you. Encode/decode live here so API and worker cannot drift.
 */
export function encodeIngestionMessage(message: IngestionQueueMessage): string {
  return Buffer.from(JSON.stringify(message), 'utf8').toString('base64');
}

export function decodeIngestionMessage(text: string): IngestionQueueMessage {
  return ingestionQueueMessageSchema.parse(
    JSON.parse(Buffer.from(text, 'base64').toString('utf8')),
  );
}

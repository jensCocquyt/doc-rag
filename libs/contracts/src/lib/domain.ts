import { z } from 'zod';

/**
 * text-embedding-3-small dimensionality; must match the pgvector column.
 * Changing it requires a reindex.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const documentStatusSchema = z.enum([
  'uploading',
  'uploaded',
  'queued',
  'processing',
  'ready',
  'failed',
  'deleting',
  'deleted',
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const ingestionJobStatusSchema = z.enum([
  'queued',
  'processing',
  'succeeded',
  'failed',
  'poisoned',
]);
export type IngestionJobStatus = z.infer<typeof ingestionJobStatusSchema>;

export const messageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageStatusSchema = z.enum([
  'pending',
  'streaming',
  'completed',
  'failed',
  'cancelled',
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

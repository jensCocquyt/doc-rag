import { SQL, sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/** text-embedding-3-small dimensionality; changing it requires a reindex. */
export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ...timestamps,
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalIdentityId: text('external_identity_id'),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    ...timestamps,
  },
  (t) => [
    index('users_tenant_idx').on(t.tenantId),
    uniqueIndex('users_tenant_email_idx').on(t.tenantId, t.email),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: text('content_hash'),
    status: text('status').notNull().default('uploading'),
    // No FK: documents ↔ document_versions would be circular. Integrity is
    // enforced in application code.
    activeVersionId: uuid('active_version_id'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('documents_tenant_idx').on(t.tenantId),
    index('documents_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    versionNumber: integer('version_number').notNull(),
    storageKey: text('storage_key').notNull(),
    contentHash: text('content_hash'),
    parserVersion: text('parser_version'),
    normalizedArtifactKey: text('normalized_artifact_key'),
    pageCount: integer('page_count'),
    worksheetCount: integer('worksheet_count'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('document_versions_document_version_idx').on(
      t.documentId,
      t.versionNumber,
    ),
  ],
);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('ingestion_jobs_idempotency_idx').on(t.idempotencyKey),
    index('ingestion_jobs_version_idx').on(t.documentVersionId),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id),
    sequence: integer('sequence').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${chunks.content})`,
    ),
    headingContext: text('heading_context'),
    locator: jsonb('locator').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('chunks_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
    index('chunks_search_vector_idx').using('gin', t.searchVector),
    index('chunks_tenant_document_idx').on(t.tenantId, t.documentId),
    index('chunks_document_version_idx').on(t.documentVersionId),
    uniqueIndex('chunks_version_sequence_idx').on(
      t.documentVersionId,
      t.sequence,
    ),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title'),
    summary: text('summary'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('conversations_tenant_user_idx').on(t.tenantId, t.userId)],
);

export const conversationDocuments = pgTable(
  'conversation_documents',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.documentId] })],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    role: text('role').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull().default('pending'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId)],
);

export const messageCitations = pgTable(
  'message_citations',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => chunks.id),
    citationNumber: integer('citation_number').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.chunkId] })],
);

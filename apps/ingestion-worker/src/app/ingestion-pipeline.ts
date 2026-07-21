import { createHash } from 'node:crypto';
import { chunkElements, CHUNKER_VERSION } from '@doc-rag/chunking';
import { decodeIngestionMessage } from '@doc-rag/contracts';
import type { IngestionQueueMessage } from '@doc-rag/contracts';
import type {
  ChunkRepository,
  DocumentRepository,
  DocumentVersionRepository,
  IngestionJobRepository,
} from '@doc-rag/database';
import {
  PageLimitExceededError,
  ParserRegistry,
  UnsupportedMimeTypeError,
} from '@doc-rag/document-processing';
import type { EmbeddingService } from '@doc-rag/embeddings';
import type { ObjectStorage } from '@doc-rag/storage';

/**
 * An error that retrying can never fix (bad file, exceeded limits, deleted
 * document). The pipeline marks the job and document failed and acknowledges
 * the message instead of burning retry attempts.
 */
export class PermanentIngestionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentIngestionError';
  }
}

export interface IngestionPipelineOptions {
  maxPages: number;
  maxFileSizeBytes: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
}

export interface IngestionPipelineDeps {
  documents: DocumentRepository;
  versions: DocumentVersionRepository;
  jobs: IngestionJobRepository;
  chunks: ChunkRepository;
  originals: ObjectStorage;
  artifacts: ObjectStorage;
  parsers: ParserRegistry;
  embeddings: EmbeddingService;
  options: IngestionPipelineOptions;
  log: (message: string) => void;
}

async function streamToBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const part of stream) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += buffer.length;
    if (total > maxBytes) {
      throw new PermanentIngestionError(
        'file_too_large',
        `Stored object exceeds the ${maxBytes}-byte limit`,
      );
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts);
}

/**
 * Parse → normalize → persist artifact → chunk → embed → insert → ready
 * (PLAN.md Phase 3). Idempotent under at-least-once delivery: a succeeded job
 * acknowledges without work, and a retry wipes the version's chunks before
 * rewriting them (unique (version, sequence) is the second guard).
 */
export class IngestionPipeline {
  constructor(private readonly deps: IngestionPipelineDeps) {}

  /** QueueConsumer handler. Throwing means "retry me"; returning acknowledges. */
  async handleMessage(messageText: string): Promise<void> {
    let message: IngestionQueueMessage;
    try {
      message = decodeIngestionMessage(messageText);
    } catch {
      // Undecodable payloads can never succeed; let retries exhaust into the
      // poison queue where the raw text stays inspectable.
      throw new Error('Undecodable ingestion message');
    }

    const { jobs, documents, log } = this.deps;
    const job = await jobs.findById(message.jobId);
    if (!job) {
      log(`job ${message.jobId} no longer exists; acknowledging`);
      return;
    }
    if (job.status === 'succeeded') {
      log(`job ${job.id} already succeeded; acknowledging duplicate delivery`);
      return;
    }

    try {
      await this.ingest(message, job.attempt + 1);
    } catch (error) {
      if (error instanceof PermanentIngestionError) {
        log(`job ${job.id} failed permanently (${error.code}): ${error.message}`);
        await jobs.markFailed(job.id, 'failed', error.code, error.message);
        await documents.setStatus(
          message.tenantId,
          message.documentId,
          'failed',
        );
        return;
      }
      // Transient: record and rethrow so the consumer schedules a retry.
      const detail = error instanceof Error ? error.message : String(error);
      log(`job ${job.id} attempt failed transiently: ${detail}`);
      await jobs
        .markFailed(job.id, 'queued', 'transient_error', detail)
        .catch(() => undefined);
      throw error;
    }
  }

  /** QueueConsumer onPoison callback: mark the job and document terminally failed. */
  async handlePoison(messageText: string): Promise<void> {
    try {
      const message = decodeIngestionMessage(messageText);
      await this.deps.jobs.markFailed(
        message.jobId,
        'poisoned',
        'retries_exhausted',
        'Moved to the poison queue after exhausting delivery attempts',
      );
      await this.deps.documents.setStatus(
        message.tenantId,
        message.documentId,
        'failed',
      );
    } catch {
      this.deps.log('poisoned message could not be decoded; nothing to mark');
    }
  }

  private async ingest(
    message: IngestionQueueMessage,
    attempt: number,
  ): Promise<void> {
    const startedAt = Date.now();
    const {
      documents,
      versions,
      jobs,
      chunks,
      originals,
      artifacts,
      parsers,
      embeddings,
      options,
      log,
    } = this.deps;

    const document = await documents.findById(
      message.tenantId,
      message.documentId,
    );
    if (!document) {
      throw new PermanentIngestionError(
        'document_deleted',
        'Document was deleted before ingestion',
      );
    }
    const version = await versions.findById(message.documentVersionId);
    if (!version) {
      throw new PermanentIngestionError(
        'missing_version',
        'Document version record does not exist',
      );
    }

    await jobs.markProcessing(message.jobId, attempt);
    await documents.setStatus(message.tenantId, document.id, 'processing');

    let bytes: Buffer;
    try {
      bytes = await streamToBuffer(
        await originals.readObjectStream(version.storageKey),
        options.maxFileSizeBytes,
      );
    } catch (error) {
      if (error instanceof PermanentIngestionError) throw error;
      // Storage read failures are typically transient (network, Azurite down).
      throw error instanceof Error
        ? error
        : new Error('Failed to read stored object');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    // File-signature check before any parsing: MIME type is client-declared
    // and cannot be trusted (PLAN.md Phase 10 security).
    if (
      document.mimeType === 'application/pdf' &&
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    ) {
      throw new PermanentIngestionError(
        'invalid_file_signature',
        'Stored bytes are not a PDF (magic-number mismatch)',
      );
    }

    let parser;
    try {
      parser = parsers.get(document.mimeType);
    } catch (error) {
      if (error instanceof UnsupportedMimeTypeError) {
        throw new PermanentIngestionError('unsupported_mime_type', error.message);
      }
      throw error;
    }

    let normalized;
    try {
      normalized = await parser.parse(new Uint8Array(bytes), {
        maxPages: options.maxPages,
      });
    } catch (error) {
      if (error instanceof PageLimitExceededError) {
        throw new PermanentIngestionError('page_limit_exceeded', error.message);
      }
      // A file that fails to parse will fail identically on every retry.
      throw new PermanentIngestionError(
        'parse_failed',
        error instanceof Error ? error.message : 'Unparsable document',
      );
    }
    if (normalized.elements.length === 0) {
      throw new PermanentIngestionError(
        'no_text_content',
        'No extractable text (scanned PDFs are not supported in the POC)',
      );
    }

    // Normalized output is stored apart from embeddings so reindexing and
    // chunker changes never require reparsing (PLAN.md §7).
    const artifactKey = `${version.storageKey.replace(/\/[^/]+$/, '')}/normalized.json`;
    await artifacts.writeObject(
      artifactKey,
      JSON.stringify(normalized),
      'application/json',
    );
    await versions.updateParseResult(version.id, {
      parserVersion: `${normalized.parserName}@${normalized.parserVersion};chunker@${CHUNKER_VERSION}`,
      normalizedArtifactKey: artifactKey,
      pageCount: normalized.pageCount,
      contentHash,
    });

    const documentChunks = chunkElements(normalized.elements, {
      targetTokens: options.chunkTargetTokens,
      overlapTokens: options.chunkOverlapTokens,
    });
    const vectors = await embeddings.embed(
      documentChunks.map((chunk) => chunk.content),
    );

    // Retry safety: replace the version's chunks wholesale before insert.
    await chunks.deleteByDocumentVersion(version.id);
    await chunks.insertMany(
      documentChunks.map((chunk, index) => ({
        tenantId: message.tenantId,
        documentId: document.id,
        documentVersionId: version.id,
        sequence: chunk.sequence,
        content: chunk.content,
        contentHash: chunk.contentHash,
        tokenCount: chunk.tokenCount,
        embedding: vectors[index],
        headingContext: chunk.headingContext,
        locator: chunk.locator,
        metadata: { chunkerVersion: CHUNKER_VERSION },
      })),
    );

    await documents.setContentHash(message.tenantId, document.id, contentHash);
    await documents.setStatus(message.tenantId, document.id, 'ready');
    await jobs.markSucceeded(message.jobId);
    // Ingestion metrics (PLAN.md Phase 10): counts, durations and approximate
    // embedding volume — never document text.
    const embeddedTokens = documentChunks.reduce(
      (sum, chunk) => sum + chunk.tokenCount,
      0,
    );
    log(
      `job ${message.jobId} succeeded: ${normalized.pageCount} pages, ${normalized.elements.length} elements, ${documentChunks.length} chunks, ~${embeddedTokens} embedded tokens, ${Date.now() - startedAt}ms total`,
    );
  }
}

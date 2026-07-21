/**
 * Rebuilds chunks + embeddings for every ready document from its stored
 * normalized artifact — WITHOUT reparsing any PDF (PLAN.md Phase 10:
 * reindex without reparse; proves extraction output and embeddings are
 * independent). Use after changing the chunker or the embedding model.
 *
 *   pnpm tsx tools/scripts/reindex.ts
 */
import { and, eq, isNull } from 'drizzle-orm';
import { chunkElements, CHUNKER_VERSION } from '@doc-rag/chunking';
import { loadDotenv, loadWorkerEnv } from '@doc-rag/config';
import {
  chunks,
  createDatabase,
  createPool,
  documents,
  documentVersions,
  DrizzleChunkRepository,
  messageCitations,
} from '@doc-rag/database';
import type { NormalizedDocument } from '@doc-rag/document-processing';
import {
  AzureOpenAiEmbeddingService,
  DeterministicEmbeddingService,
  type EmbeddingService,
} from '@doc-rag/embeddings';
import { AzureBlobObjectStorage } from '@doc-rag/storage';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream) {
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  }
  return Buffer.concat(parts);
}

async function main(): Promise<void> {
  loadDotenv();
  const env = loadWorkerEnv();
  const embeddings: EmbeddingService =
    env.AI_PROVIDER === 'fake'
      ? new DeterministicEmbeddingService()
      : new AzureOpenAiEmbeddingService({
          resourceName: env.AZURE_OPENAI_RESOURCE_NAME as string,
          apiKey: env.AZURE_OPENAI_API_KEY as string,
          deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT as string,
          batchSize: env.EMBEDDING_BATCH_SIZE,
        });
  const pool = createPool(env.DATABASE_URL);
  const db = createDatabase(pool);
  const chunkRepo = new DrizzleChunkRepository(db);
  const artifacts = new AzureBlobObjectStorage({
    connectionString: env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
    containerName: env.AZURE_STORAGE_BLOB_CONTAINER_ARTIFACTS,
  });

  try {
    const rows = await db
      .select({
        documentId: documents.id,
        tenantId: documents.tenantId,
        fileName: documents.fileName,
        versionId: documentVersions.id,
        artifactKey: documentVersions.normalizedArtifactKey,
      })
      .from(documents)
      .innerJoin(
        documentVersions,
        eq(documentVersions.id, documents.activeVersionId),
      )
      .where(and(eq(documents.status, 'ready'), isNull(documents.deletedAt)));

    console.log(`[reindex] ${rows.length} ready document(s)`);
    for (const row of rows) {
      if (!row.artifactKey) {
        console.log(`[reindex] skip ${row.fileName}: no normalized artifact`);
        continue;
      }
      let artifact: NormalizedDocument;
      try {
        artifact = JSON.parse(
          (
            await streamToBuffer(
              await artifacts.readObjectStream(row.artifactKey),
            )
          ).toString('utf8'),
        ) as NormalizedDocument;
      } catch (error) {
        // Missing/unreadable artifact (e.g. test fixtures in throwaway
        // containers): keep the existing chunks and continue.
        console.warn(
          `[reindex] skip ${row.fileName}: artifact unreadable (${error instanceof Error ? error.message.split('\n')[0] : error})`,
        );
        continue;
      }
      // Cited chunks are answer provenance (message_citations FK) and must
      // never be destroyed; keep such versions as-is.
      const [cited] = await db
        .select({ chunkId: messageCitations.chunkId })
        .from(messageCitations)
        .innerJoin(chunks, eq(chunks.id, messageCitations.chunkId))
        .where(eq(chunks.documentVersionId, row.versionId))
        .limit(1);
      if (cited) {
        console.warn(
          `[reindex] skip ${row.fileName}: chunks are cited by stored answers (provenance preserved)`,
        );
        continue;
      }
      const rebuilt = chunkElements(artifact.elements, {
        targetTokens: env.CHUNK_TARGET_TOKENS,
        overlapTokens: env.CHUNK_OVERLAP_TOKENS,
      });
      const vectors = await embeddings.embed(rebuilt.map((c) => c.content));
      await chunkRepo.deleteByDocumentVersion(row.versionId);
      await chunkRepo.insertMany(
        rebuilt.map((chunk, index) => ({
          tenantId: row.tenantId,
          documentId: row.documentId,
          documentVersionId: row.versionId,
          sequence: chunk.sequence,
          content: chunk.content,
          contentHash: chunk.contentHash,
          tokenCount: chunk.tokenCount,
          embedding: vectors[index],
          headingContext: chunk.headingContext,
          locator: chunk.locator,
          metadata: { chunkerVersion: CHUNKER_VERSION, reindexed: true },
        })),
      );
      console.log(
        `[reindex] ${row.fileName}: ${rebuilt.length} chunks rebuilt from artifact`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[reindex] failed:', error);
  process.exit(1);
});

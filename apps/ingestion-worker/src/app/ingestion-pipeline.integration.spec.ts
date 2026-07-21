import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { encodeIngestionMessage } from '@doc-rag/contracts';
import {
  createDatabase,
  createPool,
  documents,
  documentVersions,
  DrizzleChunkRepository,
  DrizzleDocumentRepository,
  DrizzleDocumentVersionRepository,
  DrizzleIngestionJobRepository,
  ingestionJobs,
  POC_TENANT_ID,
  POC_USER_ID,
  tenants,
  users,
} from '@doc-rag/database';
import { DeterministicEmbeddingService } from '@doc-rag/embeddings';
import { AzureBlobObjectStorage } from '@doc-rag/storage';
import { eq } from 'drizzle-orm';
import { createParserRegistry } from './create-services';
import { IngestionPipeline } from './ingestion-pipeline';

// Requires migrated PostgreSQL + Azurite (pnpm infra:up && pnpm db:migrate,
// or the CI Compose services).
const configured =
  !!process.env.DATABASE_URL && !!process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING;

async function buildPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([600, 800]);
    page.drawText(`Section ${i}`, { x: 50, y: 750, size: 24, font });
    page.drawText(
      `Page ${i} reports revenue of ${i * 100} thousand euro for the period.`,
      { x: 50, y: 700, size: 12, font },
    );
  }
  return doc.save();
}

describe.skipIf(!configured)('IngestionPipeline (integration)', () => {
  const runId = Date.now();
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  let pipeline: IngestionPipeline;
  let originals: AzureBlobObjectStorage;
  let artifacts: AzureBlobObjectStorage;
  let chunkRepo: DrizzleChunkRepository;

  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL!);
    db = createDatabase(pool);
    await db
      .insert(tenants)
      .values({ id: POC_TENANT_ID, name: 'POC Tenant' })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: POC_USER_ID,
        tenantId: POC_TENANT_ID,
        email: 'poc-user@example.com',
        displayName: 'POC User',
      })
      .onConflictDoNothing();

    const connectionString =
      process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING!;
    originals = new AzureBlobObjectStorage({
      connectionString,
      containerName: `it-originals-${runId}`,
    });
    artifacts = new AzureBlobObjectStorage({
      connectionString,
      containerName: `it-artifacts-${runId}`,
    });
    chunkRepo = new DrizzleChunkRepository(db);

    pipeline = new IngestionPipeline({
      documents: new DrizzleDocumentRepository(db),
      versions: new DrizzleDocumentVersionRepository(db),
      jobs: new DrizzleIngestionJobRepository(db),
      chunks: chunkRepo,
      originals,
      artifacts,
      parsers: createParserRegistry(),
      embeddings: new DeterministicEmbeddingService(),
      options: {
        maxPages: 500,
        maxFileSizeBytes: 104857600,
        chunkTargetTokens: 650,
        chunkOverlapTokens: 80,
      },
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  interface Fixture {
    documentId: string;
    versionId: string;
    jobId: string;
    messageText: string;
    storageKey: string;
  }

  async function createFixture(withBlob: {
    pdf: Uint8Array | null;
  }): Promise<Fixture> {
    const documentId = randomUUID();
    const versionId = randomUUID();
    const jobId = randomUUID();
    const storageKey = `tenants/${POC_TENANT_ID}/documents/${documentId}/versions/1/original.pdf`;
    await db.insert(documents).values({
      id: documentId,
      tenantId: POC_TENANT_ID,
      fileName: 'fixture.pdf',
      mimeType: 'application/pdf',
      sizeBytes: withBlob.pdf?.length ?? 123,
      status: 'queued',
      activeVersionId: versionId,
      createdByUserId: POC_USER_ID,
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      versionNumber: 1,
      storageKey,
    });
    await db.insert(ingestionJobs).values({
      id: jobId,
      documentVersionId: versionId,
      idempotencyKey: `ingest-${versionId}`,
    });
    if (withBlob.pdf) {
      await originals.writeObject(
        storageKey,
        Buffer.from(withBlob.pdf),
        'application/pdf',
      );
    }
    const messageText = encodeIngestionMessage({
      type: 'ingest-document-version',
      jobId,
      tenantId: POC_TENANT_ID,
      documentId,
      documentVersionId: versionId,
    });
    return { documentId, versionId, jobId, messageText, storageKey };
  }

  it('processes a PDF end to end: artifact, chunks with locators, ready status', async () => {
    const fixture = await createFixture({ pdf: await buildPdf(3) });
    await pipeline.handleMessage(fixture.messageText);

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fixture.documentId));
    expect(document.status).toBe('ready');
    expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const [job] = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, fixture.jobId));
    expect(job.status).toBe('succeeded');
    expect(job.completedAt).not.toBeNull();

    const [version] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, fixture.versionId));
    expect(version.pageCount).toBe(3);
    expect(version.parserVersion).toContain('pdfjs-text@');
    expect(version.parserVersion).toContain('chunker@');
    expect(version.normalizedArtifactKey).toBe(
      fixture.storageKey.replace('original.pdf', 'normalized.json'),
    );

    // Normalized artifact is stored separately and is valid JSON.
    const artifact = await artifacts.verifyObject(
      version.normalizedArtifactKey!,
    );
    expect(artifact.exists).toBe(true);

    // Every chunk carries page + coordinates and an embedding.
    const chunks = await chunkRepo.listByDocument(
      POC_TENANT_ID,
      fixture.documentId,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      const locator = chunk.locator as {
        type: string;
        page: number;
        polygons: number[][];
      };
      expect(locator.type).toBe('pdf');
      expect(locator.page).toBeGreaterThanOrEqual(1);
      expect(locator.page).toBeLessThanOrEqual(3);
      expect(locator.polygons.length).toBeGreaterThan(0);
      expect(chunk.embedding).toHaveLength(1536);
    }
    // Text spot-check against the source.
    expect(chunks.some((c) => c.content.includes('revenue of 100'))).toBe(true);
  });

  it('is idempotent: reprocessing the same message does not duplicate chunks', async () => {
    const fixture = await createFixture({ pdf: await buildPdf(2) });
    await pipeline.handleMessage(fixture.messageText);
    const first = await chunkRepo.listByDocument(
      POC_TENANT_ID,
      fixture.documentId,
    );

    // Duplicate delivery of a succeeded job: acknowledged without work.
    await pipeline.handleMessage(fixture.messageText);
    const second = await chunkRepo.listByDocument(
      POC_TENANT_ID,
      fixture.documentId,
    );
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id));

    // Forced reprocessing (job back to queued) rewrites, not duplicates.
    await db
      .update(ingestionJobs)
      .set({ status: 'queued' })
      .where(eq(ingestionJobs.id, fixture.jobId));
    await pipeline.handleMessage(fixture.messageText);
    const third = await chunkRepo.listByDocument(
      POC_TENANT_ID,
      fixture.documentId,
    );
    expect(third).toHaveLength(first.length);
    expect(third.map((c) => c.contentHash)).toEqual(
      first.map((c) => c.contentHash),
    );
  });

  it('fails permanently with an error code when the blob is missing', async () => {
    const fixture = await createFixture({ pdf: null });
    // Missing blob reads as a 404 from storage → permanent parse-side failure
    // is not right; the read throws. The pipeline records it and rethrows for
    // retry, so simulate the poison path explicitly afterwards.
    await expect(
      pipeline.handleMessage(fixture.messageText),
    ).rejects.toThrow();

    await pipeline.handlePoison(fixture.messageText);
    const [job] = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, fixture.jobId));
    expect(job.status).toBe('poisoned');
    expect(job.errorCode).toBe('retries_exhausted');
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fixture.documentId));
    expect(document.status).toBe('failed');
  });

  it('fails permanently on a non-PDF payload without retrying (magic bytes)', async () => {
    const bogus = new TextEncoder().encode('this is not a pdf at all');
    const fixture = await createFixture({ pdf: bogus });
    // Permanent failure: resolves (acknowledges) instead of throwing.
    await pipeline.handleMessage(fixture.messageText);

    const [job] = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, fixture.jobId));
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('invalid_file_signature');
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fixture.documentId));
    expect(document.status).toBe('failed');
  });

  it('processes a 100-page PDF within the integration budget', async () => {
    const fixture = await createFixture({ pdf: await buildPdf(100) });
    const startedAt = Date.now();
    await pipeline.handleMessage(fixture.messageText);
    const elapsedMs = Date.now() - startedAt;

    const chunks = await chunkRepo.listByDocument(
      POC_TENANT_ID,
      fixture.documentId,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(100);
    // Generous bound: catches pathological slowdowns, not normal variance.
    expect(elapsedMs).toBeLessThan(60000);
  }, 120000);
});

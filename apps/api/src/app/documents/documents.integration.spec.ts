import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { QueueServiceClient } from '@azure/storage-queue';
import { eq } from 'drizzle-orm';
import {
  decodeIngestionMessage,
  uploadSessionResponseSchema,
  type DocumentDto,
  type UploadSessionResponse,
} from '@doc-rag/contracts';
import {
  createDatabase,
  createPool,
  documentVersions,
  ingestionJobs,
  POC_TENANT_ID,
  POC_USER_ID,
  tenants,
  users,
} from '@doc-rag/database';
import { AppModule } from '../app.module';

// Requires migrated PostgreSQL + Azurite (pnpm infra:up && pnpm db:migrate,
// or the CI Compose services).
const configured =
  !!process.env.DATABASE_URL &&
  !!process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING &&
  !!process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING;

describe.skipIf(!configured)('Documents API (integration)', () => {
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;

  // Dedicated queue per run: keeps the test from draining the shared dev
  // queue (stranding real documents at 'queued') and from feeding a locally
  // running worker.
  const testQueueName = `it-api-ingestion-${Date.now()}`;

  const ingestionQueue = () =>
    QueueServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING!,
    ).getQueueClient(testQueueName);

  beforeAll(async () => {
    process.env.AZURE_STORAGE_QUEUE_INGESTION = testQueueName;
    pool = createPool(process.env.DATABASE_URL!);
    db = createDatabase(pool);
    // The endpoints attribute everything to the fixed POC identity; make sure
    // it exists even when db:seed has not run on this database.
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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await ingestionQueue().deleteIfExists();
    delete process.env.AZURE_STORAGE_QUEUE_INGESTION;
    await app?.close();
    await pool?.end();
  });

  const createdDocumentIds: string[] = [];

  async function createSession(
    overrides: Partial<{
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }> = {},
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/documents/upload-sessions',
      payload: {
        fileName: 'integration.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        ...overrides,
      },
    });
    if (response.statusCode === 201) {
      createdDocumentIds.push(
        (response.json() as UploadSessionResponse).documentId,
      );
    }
    return response;
  }

  afterAll(async () => {
    // Soft-delete this run's documents so the shared dev library stays clean.
    for (const id of createdDocumentIds) {
      await app
        .inject({ method: 'DELETE', url: `/documents/${id}` })
        .catch(() => undefined);
    }
  });

  async function putToStorage(
    session: UploadSessionResponse,
    content: Buffer,
  ): Promise<number> {
    const response = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: session.uploadHeaders,
      body: content,
    });
    return response.status;
  }

  it('runs the full upload flow and completion is idempotent', async () => {
    const content = Buffer.from('%PDF-1.4 integration fixture');
    await ingestionQueue().createIfNotExists();
    await ingestionQueue().clearMessages();

    const sessionResponse = await createSession({
      sizeBytes: content.length,
    });
    expect(sessionResponse.statusCode).toBe(201);
    const session = uploadSessionResponseSchema.parse(
      sessionResponse.json(),
    );

    expect(await putToStorage(session, content)).toBe(201);

    const complete = await app.inject({
      method: 'POST',
      url: `/documents/${session.documentId}/complete-upload`,
    });
    expect(complete.statusCode).toBe(200);
    const completed = complete.json() as DocumentDto;
    expect(completed.status).toBe('queued');

    // Repeat completion: same outcome, still exactly one ingestion job.
    const repeat = await app.inject({
      method: 'POST',
      url: `/documents/${session.documentId}/complete-upload`,
    });
    expect(repeat.statusCode).toBe(200);
    expect((repeat.json() as DocumentDto).status).toBe('queued');

    const [version] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, session.documentId));
    const jobs = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.documentVersionId, version.id));
    expect(jobs).toHaveLength(1);

    // The queue message references the same job/document/version.
    const received = await ingestionQueue().receiveMessages({
      numberOfMessages: 32,
    });
    const decoded = received.receivedMessageItems.map((item) =>
      decodeIngestionMessage(item.messageText),
    );
    const forThisDocument = decoded.filter(
      (message) => message.documentId === session.documentId,
    );
    expect(forThisDocument.length).toBeGreaterThanOrEqual(1);
    expect(forThisDocument[0]).toEqual({
      type: 'ingest-document-version',
      jobId: jobs[0].id,
      tenantId: POC_TENANT_ID,
      documentId: session.documentId,
      documentVersionId: version.id,
    });

    // Document shows up in list and detail.
    const list = await app.inject({ method: 'GET', url: '/documents' });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { documents: DocumentDto[] }).documents;
    expect(listed.some((d) => d.id === session.documentId)).toBe(true);

    // Soft delete hides it.
    const del = await app.inject({
      method: 'DELETE',
      url: `/documents/${session.documentId}`,
    });
    expect(del.statusCode).toBe(204);
    const afterDelete = await app.inject({
      method: 'GET',
      url: `/documents/${session.documentId}`,
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('rejects completion when nothing was uploaded', async () => {
    const sessionResponse = await createSession();
    const session = sessionResponse.json() as UploadSessionResponse;
    const complete = await app.inject({
      method: 'POST',
      url: `/documents/${session.documentId}/complete-upload`,
    });
    expect(complete.statusCode).toBe(400);
    expect((complete.json() as { code: string }).code).toBe(
      'file_not_uploaded',
    );
  });

  it('rejects completion when the uploaded size differs from the declared size', async () => {
    const sessionResponse = await createSession({ sizeBytes: 4096 });
    const session = uploadSessionResponseSchema.parse(sessionResponse.json());
    expect(await putToStorage(session, Buffer.from('short'))).toBe(201);
    const complete = await app.inject({
      method: 'POST',
      url: `/documents/${session.documentId}/complete-upload`,
    });
    expect(complete.statusCode).toBe(400);
    expect((complete.json() as { code: string }).code).toBe('size_mismatch');
  });

  it('rejects an invalid file type with a clear error', async () => {
    const response = await createSession({ fileName: 'evil.exe' });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe(
      'validation_failed',
    );
  });

  it('rejects an oversized file with a clear error', async () => {
    const response = await createSession({ sizeBytes: 104857601 });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe('file_too_large');
  });

  it('returns 404 for an unknown document id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-4000-8000-0000000000ff',
    });
    expect(response.statusCode).toBe(404);
  });
});

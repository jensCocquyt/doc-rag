import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadApiEnv } from '@doc-rag/config';
import {
  createDatabase,
  createPool,
  POC_TENANT_ID,
  POC_USER_ID,
  tenants,
  users,
} from '@doc-rag/database';
import { AppModule } from './app.module';
import {
  createHardenedAdapter,
  registerHttpHardening,
} from './http-hardening';

// Requires migrated PostgreSQL + Azurite (pnpm infra:up && pnpm db:migrate).
const configured =
  !!process.env.DATABASE_URL &&
  !!process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING &&
  !!process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING;

describe.skipIf(!configured)('HTTP hardening (integration)', () => {
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL!);
    const db = createDatabase(pool);
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

    // Tiny chat quota so the limit is reachable in a test.
    process.env.CHAT_REQUESTS_PER_USER_PER_HOUR = '2';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createHardenedAdapter(loadApiEnv()),
    );
    await registerHttpHardening(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    delete process.env.CHAT_REQUESTS_PER_USER_PER_HOUR;
    await app?.close();
    await pool?.end();
  });

  it('adds a correlation id header to every response', async () => {
    const response = await app.inject({ method: 'GET', url: '/documents' });
    expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('rejects oversized request bodies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/documents/upload-sessions',
      headers: { 'content-type': 'application/json' },
      payload: `{"fileName":"a.pdf","mimeType":"application/pdf","padding":"${'x'.repeat(
        2 * 1024 * 1024,
      )}"}`,
    });
    expect(response.statusCode).toBe(413);
  });

  it('enforces the per-user chat quota with 429', async () => {
    const conversation = await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: { title: 'quota' },
    });
    const conversationId = (conversation.json() as { id: string }).id;
    const post = () =>
      app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        payload: { content: 'quota probe question' },
      });
    expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(200);
    const third = await post();
    expect(third.statusCode).toBe(429);
    expect((third.json() as { code: string }).code).toBe(
      'chat_quota_exceeded',
    );
  });
});

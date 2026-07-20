import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { EntraTokenVerifier } from '@doc-rag/auth';
import {
  auditEvents,
  createDatabase,
  createPool,
  documents,
  documentVersions,
  POC_TENANT_ID,
  POC_USER_ID,
  tenants,
  users,
} from '@doc-rag/database';
import { desc, eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { TOKEN_VERIFIER } from './auth.module';

// Requires migrated PostgreSQL + Azurite (pnpm infra:up && pnpm db:migrate).
const configured =
  !!process.env.DATABASE_URL &&
  !!process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING &&
  !!process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING;

const ENTRA_TENANT = '22222222-2222-2222-2222-222222222222';
const AUDIENCE = 'api://docrag-test';
const ISSUER = `https://login.microsoftonline.com/${ENTRA_TENANT}/v2.0`;

describe.skipIf(!configured)('Entra authentication (integration)', () => {
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  let signToken: (subject: string) => Promise<string>;

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

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'it-key';
    const verifier = new EntraTokenVerifier({
      tenantId: ENTRA_TENANT,
      audience: AUDIENCE,
      getKey: createLocalJWKSet({ keys: [jwk] }),
    });
    signToken = (subject: string) =>
      new SignJWT({
        tid: ENTRA_TENANT,
        preferred_username: `${subject}@example.com`,
        name: `User ${subject}`,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'it-key' })
        .setSubject(subject)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

    process.env.AUTH_MODE = 'entra';
    process.env.ENTRA_TENANT_ID = ENTRA_TENANT;
    process.env.ENTRA_API_AUDIENCE = AUDIENCE;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    delete process.env.AUTH_MODE;
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_API_AUDIENCE;
    await app?.close();
    await pool?.end();
  });

  it('rejects unauthenticated API calls and records an audit event', async () => {
    const response = await app.inject({ method: 'GET', url: '/documents' });
    expect(response.statusCode).toBe(401);
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'auth.failed'))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    expect(event?.outcome).toBe('denied');
  });

  it('rejects a forged token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/documents',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
    expect((response.json() as { code: string }).code).toBe('invalid_token');
  });

  it('keeps /health public for probes', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect([200, 503]).toContain(response.statusCode);
  });

  it('accepts a valid token and provisions the user on first login', async () => {
    const subject = `it-subject-${Date.now()}`;
    const response = await app.inject({
      method: 'GET',
      url: '/documents',
      headers: { authorization: `Bearer ${await signToken(subject)}` },
    });
    expect(response.statusCode).toBe(200);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.externalIdentityId, subject));
    expect(user).toBeDefined();
    expect(user.tenantId).toBe(POC_TENANT_ID);

    // Second call reuses the same user (no duplicate provisioning).
    await app.inject({
      method: 'GET',
      url: '/documents',
      headers: { authorization: `Bearer ${await signToken(subject)}` },
    });
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.externalIdentityId, subject));
    expect(rows).toHaveLength(1);
  });

  it('cannot reach another tenant\'s document by guessed id (IDOR)', async () => {
    // A document in a different tenant, with a stored version.
    const otherTenant = randomUUID();
    const otherUser = randomUUID();
    const otherDoc = randomUUID();
    const otherVersion = randomUUID();
    await db.insert(tenants).values({ id: otherTenant, name: 'Other' });
    await db.insert(users).values({
      id: otherUser,
      tenantId: otherTenant,
      email: `other-${otherTenant}@example.com`,
      displayName: 'Other',
    });
    await db.insert(documents).values({
      id: otherDoc,
      tenantId: otherTenant,
      fileName: 'secret.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'ready',
      activeVersionId: otherVersion,
      createdByUserId: otherUser,
    });
    await db.insert(documentVersions).values({
      id: otherVersion,
      documentId: otherDoc,
      versionNumber: 1,
      storageKey: `tenants/${otherTenant}/documents/${otherDoc}/versions/1/original.pdf`,
    });

    const token = await signToken(`idor-${Date.now()}`);
    for (const url of [
      `/documents/${otherDoc}`,
      `/documents/${otherDoc}/preview-url`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      // Not found — never a hint that the document exists elsewhere.
      expect(response.statusCode).toBe(404);
    }
  });
});

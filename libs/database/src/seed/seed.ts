import { loadDotenv, normalizeDatabaseUrl } from '@doc-rag/config';
import { createDatabase, createPool } from '../lib/client';
import { EMBEDDING_DIMENSIONS } from '../lib/schema';
import * as schema from '../lib/schema';
import { DrizzleChunkRepository } from '../lib/repositories/chunk.repository';

// Fixed IDs make the seed idempotent (PLAN.md: seed one POC tenant and user).
export const SEED_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_USER_ID = '00000000-0000-4000-8000-000000000002';
const SEED_DOCUMENT_ID = '00000000-0000-4000-8000-000000000003';
const SEED_VERSION_ID = '00000000-0000-4000-8000-000000000004';

function placeholderEmbedding(): number[] {
  // Constant non-zero vector; real embeddings arrive in Phase 3.
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.001);
}

export async function seed(connectionString: string): Promise<void> {
  const pool = createPool(normalizeDatabaseUrl(connectionString));
  const db = createDatabase(pool);
  try {
    await db
      .insert(schema.tenants)
      .values({ id: SEED_TENANT_ID, name: 'POC Tenant' })
      .onConflictDoNothing();

    await db
      .insert(schema.users)
      .values({
        id: SEED_USER_ID,
        tenantId: SEED_TENANT_ID,
        email: 'poc-user@example.com',
        displayName: 'POC User',
      })
      .onConflictDoNothing();

    await db
      .insert(schema.documents)
      .values({
        id: SEED_DOCUMENT_ID,
        tenantId: SEED_TENANT_ID,
        fileName: 'seed-sample.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        status: 'ready',
        activeVersionId: SEED_VERSION_ID,
        createdByUserId: SEED_USER_ID,
      })
      .onConflictDoNothing();

    await db
      .insert(schema.documentVersions)
      .values({
        id: SEED_VERSION_ID,
        documentId: SEED_DOCUMENT_ID,
        versionNumber: 1,
        storageKey: 'seed/seed-sample.pdf',
        pageCount: 2,
      })
      .onConflictDoNothing();

    const chunkRepository = new DrizzleChunkRepository(db);
    const existing = await chunkRepository.listByDocument(
      SEED_TENANT_ID,
      SEED_DOCUMENT_ID,
    );
    if (existing.length === 0) {
      await chunkRepository.insertMany([
        {
          tenantId: SEED_TENANT_ID,
          documentId: SEED_DOCUMENT_ID,
          documentVersionId: SEED_VERSION_ID,
          sequence: 0,
          content:
            'Seed chunk one: revenue increased by 12 percent in the fourth quarter.',
          contentHash: 'seed-chunk-0',
          tokenCount: 14,
          embedding: placeholderEmbedding(),
          locator: {
            type: 'pdf',
            page: 1,
            polygons: [[0.1, 0.2, 0.9, 0.2, 0.9, 0.3, 0.1, 0.3]],
            excerpt: 'revenue increased by 12 percent',
          },
        },
        {
          tenantId: SEED_TENANT_ID,
          documentId: SEED_DOCUMENT_ID,
          documentVersionId: SEED_VERSION_ID,
          sequence: 1,
          content:
            'Seed chunk two: operating costs remained flat year over year.',
          contentHash: 'seed-chunk-1',
          tokenCount: 11,
          embedding: placeholderEmbedding(),
          locator: {
            type: 'pdf',
            page: 2,
            polygons: [[0.1, 0.4, 0.9, 0.4, 0.9, 0.5, 0.1, 0.5]],
            excerpt: 'operating costs remained flat',
          },
        },
      ]);
    }
    console.log('[seed] POC tenant, user, document and chunks are in place');
  } finally {
    await pool.end();
  }
}

// Executed directly via `pnpm db:seed`.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('seed/seed.ts')) {
  loadDotenv();
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required (copy .env.example to .env)');
  }
  seed(url).catch((error) => {
    console.error('[seed] failed:', error);
    process.exit(1);
  });
}

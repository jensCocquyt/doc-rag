import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { normalizeDatabaseUrl } from '@doc-rag/config';
import { ChunkLocator } from '@doc-rag/contracts';
import { createDatabase, createPool, Database } from '../lib/client';
import { EMBEDDING_DIMENSIONS } from '../lib/schema';
import * as schema from '../lib/schema';
import {
  DrizzleDocumentRepository,
  DocumentRepository,
} from '../lib/repositories/document.repository';
import {
  CreateChunkInput,
  DrizzleChunkRepository,
} from '../lib/repositories/chunk.repository';

const rawUrl = process.env['DATABASE_URL'];

describe.skipIf(!rawUrl)('repositories (integration)', () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let documentRepo: DocumentRepository;
  let chunkRepo: DrizzleChunkRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let userA: string;
  let userB: string;

  const validLocator: ChunkLocator = {
    type: 'pdf',
    page: 1,
    polygons: [[0.1, 0.2, 0.9, 0.2, 0.9, 0.3, 0.1, 0.3]],
    excerpt: 'cited text',
  };

  function chunkInput(
    tenantId: string,
    documentId: string,
    documentVersionId: string,
    sequence: number,
  ): CreateChunkInput {
    return {
      tenantId,
      documentId,
      documentVersionId,
      sequence,
      content: `integration chunk ${sequence} about quarterly revenue`,
      contentHash: `it-${documentVersionId}-${sequence}`,
      tokenCount: 8,
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.002),
      locator: validLocator,
    };
  }

  async function createDocumentWithVersion(tenantId: string, userId: string) {
    const document = await documentRepo.create({
      tenantId,
      fileName: 'it.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      createdByUserId: userId,
      status: 'ready',
    });
    const [version] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: document.id,
        versionNumber: 1,
        storageKey: `it/${document.id}.pdf`,
      })
      .returning();
    return { document, version };
  }

  beforeAll(async () => {
    pool = createPool(normalizeDatabaseUrl(rawUrl as string));
    db = createDatabase(pool);
    documentRepo = new DrizzleDocumentRepository(db);
    chunkRepo = new DrizzleChunkRepository(db);

    await db.insert(schema.tenants).values([
      { id: tenantA, name: 'IT Tenant A' },
      { id: tenantB, name: 'IT Tenant B' },
    ]);
    const users = await db
      .insert(schema.users)
      .values([
        {
          tenantId: tenantA,
          email: `a-${tenantA}@it.test`,
          displayName: 'A',
        },
        {
          tenantId: tenantB,
          email: `b-${tenantB}@it.test`,
          displayName: 'B',
        },
      ])
      .returning();
    userA = users[0].id;
    userB = users[1].id;
  });

  afterAll(async () => {
    // FK-safe cleanup of everything the two test tenants own.
    for (const tenantId of [tenantA, tenantB]) {
      await db
        .delete(schema.chunks)
        .where(sql`${schema.chunks.tenantId} = ${tenantId}`);
      await db.execute(
        sql`DELETE FROM document_versions dv USING documents d
            WHERE dv.document_id = d.id AND d.tenant_id = ${tenantId}`,
      );
      await db
        .delete(schema.documents)
        .where(sql`${schema.documents.tenantId} = ${tenantId}`);
      await db
        .delete(schema.users)
        .where(sql`${schema.users.tenantId} = ${tenantId}`);
      await db
        .delete(schema.tenants)
        .where(sql`${schema.tenants.id} = ${tenantId}`);
    }
    await pool.end();
  });

  it('scopes reads to the tenant', async () => {
    const { document } = await createDocumentWithVersion(tenantA, userA);

    expect(await documentRepo.findById(tenantA, document.id)).not.toBeNull();
    expect(await documentRepo.findById(tenantB, document.id)).toBeNull();

    const listA = await documentRepo.list(tenantA);
    const listB = await documentRepo.list(tenantB);
    expect(listA.map((d) => d.id)).toContain(document.id);
    expect(listB.map((d) => d.id)).not.toContain(document.id);
  });

  it('hides soft-deleted documents from reads', async () => {
    const { document } = await createDocumentWithVersion(tenantA, userA);
    await documentRepo.softDelete(tenantA, document.id);

    expect(await documentRepo.findById(tenantA, document.id)).toBeNull();
    const list = await documentRepo.list(tenantA);
    expect(list.map((d) => d.id)).not.toContain(document.id);
  });

  it('scopes chunk reads to the tenant', async () => {
    const { document, version } = await createDocumentWithVersion(
      tenantA,
      userA,
    );
    await chunkRepo.insertMany([
      chunkInput(tenantA, document.id, version.id, 0),
      chunkInput(tenantA, document.id, version.id, 1),
    ]);

    expect(await chunkRepo.listByDocument(tenantA, document.id)).toHaveLength(
      2,
    );
    expect(await chunkRepo.listByDocument(tenantB, document.id)).toHaveLength(
      0,
    );
  });

  it('rejects chunks with an invalid locator before touching the database', async () => {
    const { document, version } = await createDocumentWithVersion(
      tenantB,
      userB,
    );
    const invalid = {
      ...chunkInput(tenantB, document.id, version.id, 0),
      locator: { type: 'pdf', page: 0, polygons: [], excerpt: '' },
    } as unknown as CreateChunkInput;

    await expect(chunkRepo.insertMany([invalid])).rejects.toThrow();
    expect(await chunkRepo.listByDocument(tenantB, document.id)).toHaveLength(
      0,
    );
  });

  it('EXPLAIN uses the HNSW index for vector search', async () => {
    const probe = `[${Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.001).join(',')}]`;
    // enable_seqscan off: the table is tiny, so the planner would otherwise
    // prefer a seq scan; this demonstrates the index is usable.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query(
        'EXPLAIN SELECT id FROM chunks ORDER BY embedding <=> $1::vector LIMIT 5',
        [probe],
      );
      const planText = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('chunks_embedding_idx');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('EXPLAIN uses the GIN index for full-text search', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query(
        `EXPLAIN SELECT id FROM chunks WHERE search_vector @@ websearch_to_tsquery('english', $1)`,
        ['revenue'],
      );
      const planText = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('chunks_search_vector_idx');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

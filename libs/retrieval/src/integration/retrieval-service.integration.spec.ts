import { randomUUID } from 'node:crypto';
import {
  chunks,
  createDatabase,
  createPool,
  documents,
  documentVersions,
  tenants,
  users,
} from '@doc-rag/database';
import { DeterministicEmbeddingService } from '@doc-rag/embeddings';
import { RetrievalService } from '../lib/retrieval-service';

// Requires migrated PostgreSQL (pnpm infra:up && pnpm db:migrate, or CI).
const configured = !!process.env['DATABASE_URL'];

describe.skipIf(!configured)('RetrievalService (integration)', () => {
  const embeddings = new DeterministicEmbeddingService();
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  let service: RetrievalService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const docFinance = randomUUID();
  const docHr = randomUUID();
  const docDeleted = randomUUID();
  const docVersioned = randomUUID();
  const docOtherTenant = randomUUID();

  // Text reused verbatim as a query → identical deterministic embedding →
  // exact top vector hit. This makes the vector arm testable without real
  // semantic embeddings.
  const FINANCE_TEXT =
    'The consolidated revenue for the fourth quarter grew by twelve percent.';
  const HR_TEXT =
    'Employee onboarding requires a signed contract and a laptop request.';
  const INVOICE_TEXT =
    'Invoice INV-2024-0042 totals 1250 euro and was paid in March.';
  const OLD_VERSION_TEXT = 'Obsolete draft text from the superseded version.';
  const NEW_VERSION_TEXT = 'Current approved text from the active version.';

  async function insertDocumentWithChunks(input: {
    documentId: string;
    tenantId: string;
    userId: string;
    fileName: string;
    status?: string;
    deleted?: boolean;
    texts: string[];
    page?: number;
  }): Promise<{ versionId: string }> {
    const versionId = randomUUID();
    await db.insert(documents).values({
      id: input.documentId,
      tenantId: input.tenantId,
      fileName: input.fileName,
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      status: input.status ?? 'ready',
      activeVersionId: versionId,
      createdByUserId: input.userId,
      deletedAt: input.deleted ? new Date() : null,
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId: input.documentId,
      versionNumber: 1,
      storageKey: `it/${input.documentId}.pdf`,
    });
    await insertChunks(input, versionId, input.texts, input.page ?? 1);
    return { versionId };
  }

  async function insertChunks(
    input: { documentId: string; tenantId: string },
    versionId: string,
    texts: string[],
    page: number,
  ): Promise<void> {
    const vectors = await embeddings.embed(texts);
    await db.insert(chunks).values(
      texts.map((text, index) => ({
        tenantId: input.tenantId,
        documentId: input.documentId,
        documentVersionId: versionId,
        sequence: index,
        content: text,
        contentHash: `it-${versionId}-${index}`,
        tokenCount: Math.ceil(text.length / 4),
        embedding: vectors[index],
        locator: {
          type: 'pdf',
          page,
          polygons: [[0.1, 0.1, 0.9, 0.1, 0.9, 0.2, 0.1, 0.2]],
          excerpt: text.slice(0, 50),
        },
      })),
    );
  }

  beforeAll(async () => {
    pool = createPool(process.env['DATABASE_URL'] as string);
    db = createDatabase(pool);
    service = new RetrievalService(db, embeddings, {
      vectorTopK: 20,
      textTopK: 20,
      finalTopK: 8,
      maxContextTokens: 9000,
    });

    await db.insert(tenants).values([
      { id: tenantA, name: 'IT Tenant A' },
      { id: tenantB, name: 'IT Tenant B' },
    ]);
    await db.insert(users).values([
      {
        id: userA,
        tenantId: tenantA,
        email: `a-${tenantA}@it.test`,
        displayName: 'A',
      },
      {
        id: userB,
        tenantId: tenantB,
        email: `b-${tenantB}@it.test`,
        displayName: 'B',
      },
    ]);

    await insertDocumentWithChunks({
      documentId: docFinance,
      tenantId: tenantA,
      userId: userA,
      fileName: 'finance.pdf',
      texts: [FINANCE_TEXT, INVOICE_TEXT],
      page: 3,
    });
    await insertDocumentWithChunks({
      documentId: docHr,
      tenantId: tenantA,
      userId: userA,
      fileName: 'hr.pdf',
      texts: [HR_TEXT],
    });
    await insertDocumentWithChunks({
      documentId: docDeleted,
      tenantId: tenantA,
      userId: userA,
      fileName: 'deleted.pdf',
      deleted: true,
      status: 'deleted',
      texts: ['Deleted document mentions consolidated revenue too.'],
    });
    await insertDocumentWithChunks({
      documentId: docOtherTenant,
      tenantId: tenantB,
      userId: userB,
      fileName: 'other-tenant.pdf',
      texts: [FINANCE_TEXT],
    });

    // Versioned document: old version chunks must never be retrieved.
    const { versionId: v1 } = await insertDocumentWithChunks({
      documentId: docVersioned,
      tenantId: tenantA,
      userId: userA,
      fileName: 'versioned.pdf',
      texts: [NEW_VERSION_TEXT],
    });
    void v1;
    const oldVersionId = randomUUID();
    await db.insert(documentVersions).values({
      id: oldVersionId,
      documentId: docVersioned,
      versionNumber: 0,
      storageKey: `it/${docVersioned}-old.pdf`,
    });
    await insertChunks(
      { documentId: docVersioned, tenantId: tenantA },
      oldVersionId,
      [OLD_VERSION_TEXT],
      1,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('retrieves the expected chunk and page via the vector arm', async () => {
    const result = await service.retrieve(
      { tenantId: tenantA, userId: userA, query: FINANCE_TEXT },
      { includeDiagnostics: true },
    );
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].content).toBe(FINANCE_TEXT);
    expect(result.chunks[0].locator.page).toBe(3);
    expect(result.chunks[0].citationId).toBe('citation-1');
    expect(result.diagnostics?.vectorRankedIds[0]).toBe(
      result.chunks[0].chunkId,
    );
  });

  it('finds lexical matches through full-text search', async () => {
    const result = await service.retrieve({
      tenantId: tenantA,
      userId: userA,
      query: 'signed contract laptop onboarding',
    });
    expect(result.chunks.some((chunk) => chunk.content === HR_TEXT)).toBe(true);
  });

  it('finds exact identifiers that full-text tokenization would mangle', async () => {
    const result = await service.retrieve(
      { tenantId: tenantA, userId: userA, query: 'total of INV-2024-0042' },
      { includeDiagnostics: true },
    );
    expect(result.chunks[0]?.content).toBe(INVOICE_TEXT);
    expect(result.diagnostics?.exactRankedIds.length).toBeGreaterThan(0);
  });

  it('never crosses tenant boundaries', async () => {
    const result = await service.retrieve({
      tenantId: tenantB,
      userId: userB,
      query: FINANCE_TEXT,
    });
    expect(result.chunks.length).toBeGreaterThan(0);
    for (const chunk of result.chunks) {
      expect(chunk.documentId).toBe(docOtherTenant);
    }
  });

  it('restricts retrieval to an explicit document selection', async () => {
    const result = await service.retrieve({
      tenantId: tenantA,
      userId: userA,
      query: FINANCE_TEXT,
      documentIds: [docHr],
    });
    for (const chunk of result.chunks) {
      expect(chunk.documentId).toBe(docHr);
    }
  });

  it('treats an empty selection as the whole tenant corpus', async () => {
    const result = await service.retrieve({
      tenantId: tenantA,
      userId: userA,
      query: FINANCE_TEXT,
      documentIds: [],
    });
    expect(result.chunks.some((c) => c.documentId === docFinance)).toBe(true);
  });

  it('excludes soft-deleted documents', async () => {
    const result = await service.retrieve({
      tenantId: tenantA,
      userId: userA,
      query: 'consolidated revenue',
    });
    for (const chunk of result.chunks) {
      expect(chunk.documentId).not.toBe(docDeleted);
    }
  });

  it('excludes chunks from superseded document versions', async () => {
    const result = await service.retrieve({
      tenantId: tenantA,
      userId: userA,
      query: OLD_VERSION_TEXT,
    });
    for (const chunk of result.chunks) {
      expect(chunk.content).not.toBe(OLD_VERSION_TEXT);
    }
  });

  it('uses the vector and full-text indexes (EXPLAIN)', async () => {
    // Tiny test tables make the planner prefer seq scans; disabling them on
    // one session proves the indexes exist and are usable.
    const client = await pool.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const [queryEmbedding] = await embeddings.embed(['index probe']);
      const vectorPlan = await client.query(
        `EXPLAIN SELECT id FROM chunks ORDER BY embedding <=> $1::vector LIMIT 5`,
        [JSON.stringify(queryEmbedding)],
      );
      const vectorPlanText = vectorPlan.rows
        .map((row: Record<string, string>) => Object.values(row)[0])
        .join('\n');
      expect(vectorPlanText).toContain('chunks_embedding_idx');

      const textPlan = await client.query(
        `EXPLAIN SELECT id FROM chunks WHERE search_vector @@ websearch_to_tsquery('english', 'revenue')`,
      );
      const textPlanText = textPlan.rows
        .map((row: Record<string, string>) => Object.values(row)[0])
        .join('\n');
      expect(textPlanText).toContain('chunks_search_vector_idx');
    } finally {
      await client.query('RESET enable_seqscan').catch(() => undefined);
      client.release();
    }
  });
});

/**
 * Retrieval evaluation harness (PLAN.md Phase 4). Seeds a synthetic document
 * with known page content, runs the fixture questions through the real
 * RetrievalService and reports, separately:
 *   - retrieval hit rate:   expected page present anywhere in the evidence set
 *   - citation correctness: the TOP result's locator points at the expected page
 *
 * Run: pnpm eval   (needs pnpm infra:up && pnpm db:migrate)
 * Uses the configured embedding provider; with AI_PROVIDER=fake only lexical
 * and verbatim questions are meaningful — the report flags this.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { loadDotenv, loadWorkerEnv } from '@doc-rag/config';
import {
  chunks,
  createDatabase,
  createPool,
  documents,
  documentVersions,
  tenants,
  users,
} from '@doc-rag/database';
import {
  AzureOpenAiEmbeddingService,
  DeterministicEmbeddingService,
  type EmbeddingService,
} from '@doc-rag/embeddings';
import { RetrievalService } from '@doc-rag/retrieval';
import { EVAL_DOCUMENT_PAGES, EVAL_QUESTIONS } from './fixtures';

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
  const tenantId = randomUUID();
  const userId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();

  try {
    // Seed an isolated tenant so runs never touch real data.
    await db.insert(tenants).values({ id: tenantId, name: 'eval-tenant' });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: `eval-${tenantId}@eval.local`,
      displayName: 'Eval',
    });
    await db.insert(documents).values({
      id: documentId,
      tenantId,
      fileName: 'eval-fixture.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      status: 'ready',
      activeVersionId: versionId,
      createdByUserId: userId,
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      versionNumber: 1,
      storageKey: 'eval/fixture.pdf',
    });
    const texts = EVAL_DOCUMENT_PAGES.map((p) => `${p.title}\n${p.body}`);
    const vectors = await embeddings.embed(texts);
    await db.insert(chunks).values(
      EVAL_DOCUMENT_PAGES.map((page, index) => ({
        tenantId,
        documentId,
        documentVersionId: versionId,
        sequence: index,
        content: texts[index],
        contentHash: `eval-${index}`,
        tokenCount: Math.ceil(texts[index].length / 4),
        embedding: vectors[index],
        headingContext: page.title,
        locator: {
          type: 'pdf',
          page: page.page,
          polygons: [[0.1, 0.1, 0.9, 0.1, 0.9, 0.2, 0.1, 0.2]],
          excerpt: page.body.slice(0, 60),
        },
      })),
    );

    const retrieval = new RetrievalService(db, embeddings, {
      vectorTopK: 20,
      textTopK: 20,
      finalTopK: 8,
      maxContextTokens: 9000,
    });

    const answerable = EVAL_QUESTIONS.filter((q) => q.expectedPage !== null);
    const unanswerable = EVAL_QUESTIONS.filter((q) => q.expectedPage === null);
    let hits = 0;
    let citationCorrect = 0;
    let refusalCorrect = 0;
    const latencies: number[] = [];
    const rows: string[] = [];
    for (const question of EVAL_QUESTIONS) {
      const startedAt = Date.now();
      const result = await retrieval.retrieve({
        tenantId,
        userId,
        query: question.question,
      });
      latencies.push(Date.now() - startedAt);
      const pages = result.chunks.map(
        (chunk) => (chunk.locator as { page: number }).page,
      );
      if (question.expectedPage === null) {
        // Refusal proxy: the expected page cannot exist; correct behavior is
        // that no retrieved chunk lexically matches the question strongly.
        // With hybrid retrieval something is usually returned — the answer
        // layer's citation requirement is the real guard. We report whether
        // the TOP result changed vs. answerable questions (best-effort
        // signal); true refusal quality needs real embeddings + model.
        const empty = result.chunks.length === 0;
        if (empty) refusalCorrect++;
        rows.push(
          `${empty ? 'REFUSED ' : 'RETRIEVED'} (unanswerable)  got [${pages.join(',') || 'none'}]  ${question.id}`,
        );
        continue;
      }
      const hit = pages.includes(question.expectedPage);
      const topCorrect = pages[0] === question.expectedPage;
      if (hit) hits++;
      if (topCorrect) citationCorrect++;
      rows.push(
        `${hit ? 'HIT ' : 'MISS'}  top=${topCorrect ? 'ok ' : 'off'}  expected p${question.expectedPage}  got [${pages.join(',') || 'none'}]  ${question.id}`,
      );
    }

    console.log('\nRetrieval evaluation');
    console.log(`provider: ${env.AI_PROVIDER}`);
    if (env.AI_PROVIDER === 'fake') {
      console.log(
        'NOTE: fake embeddings — vector arm is only meaningful for verbatim questions; semantic recall and refusal quality require AI_PROVIDER=azure.',
      );
    }
    console.log(rows.join('\n'));
    latencies.sort((a, b) => a - b);
    console.log(`\nretrieval hit rate:      ${hits}/${answerable.length}`);
    console.log(`citation page correct:   ${citationCorrect}/${answerable.length}`);
    console.log(
      `refusal (empty evidence): ${refusalCorrect}/${unanswerable.length} (see note above)`,
    );
    console.log(
      `retrieval latency:       p50 ${latencies[Math.floor(latencies.length / 2)]}ms, max ${latencies[latencies.length - 1]}ms`,
    );
    if (hits < answerable.length) {
      process.exitCode = 1;
    }
  } finally {
    // Remove the isolated eval tenant's data.
    await db.delete(chunks).where(eq(chunks.tenantId, tenantId));
    await db
      .delete(documentVersions)
      .where(eq(documentVersions.documentId, documentId));
    await db.delete(documents).where(eq(documents.id, documentId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[eval] failed:', error);
  process.exit(1);
});

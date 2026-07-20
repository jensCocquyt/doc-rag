import {
  and,
  cosineDistance,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import type { ChunkLocator } from '@doc-rag/contracts';
import { chunks, documents, type Database } from '@doc-rag/database';
import type { EmbeddingService } from '@doc-rag/embeddings';
import { assembleContext } from './context-assembly';
import { extractIdentifierTokens, reciprocalRankFusion } from './fusion';

export interface RetrievalOptions {
  vectorTopK: number;
  textTopK: number;
  finalTopK: number;
  maxContextTokens: number;
}

export interface RetrievalRequest {
  tenantId: string;
  /** Reserved for per-user authorization (Phase 9); tenant scoping applies now. */
  userId: string;
  /** Standalone query text (follow-up rewriting happens upstream). */
  query: string;
  /**
   * Explicit conversation document selection. Empty/undefined = whole tenant
   * corpus (PLAN.md: selection only narrows).
   */
  documentIds?: string[];
}

export interface RetrievedChunk {
  /** Opaque id handed to the model; resolved back server-side only. */
  citationId: string;
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  sequence: number;
  content: string;
  tokenCount: number;
  headingContext: string | null;
  locator: ChunkLocator;
  fileName: string;
}

export interface RetrievalDiagnostics {
  vectorRankedIds: string[];
  textRankedIds: string[];
  exactRankedIds: string[];
  fusedIds: string[];
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  diagnostics?: RetrievalDiagnostics;
}

/**
 * Hybrid retrieval (PLAN.md §8): one query embedding, vector + full-text
 * (+ exact identifier) arms over PostgreSQL, RRF fusion, mandatory filters,
 * dedup and token-budgeted context assembly. Every arm carries every filter —
 * scoping is enforced in SQL, not post-hoc.
 */
export class RetrievalService {
  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingService,
    private readonly options: RetrievalOptions,
  ) {}

  async retrieve(
    request: RetrievalRequest,
    { includeDiagnostics = false } = {},
  ): Promise<RetrievalResult> {
    const filters = this.mandatoryFilters(request);

    const [queryEmbedding] = await this.embeddings.embed([request.query]);
    const vectorRows = await this.db
      .select({ id: chunks.id })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(and(...filters, isNotNull(chunks.embedding)))
      .orderBy(
        sql`${cosineDistance(chunks.embedding, queryEmbedding)} asc`,
        chunks.id,
      )
      .limit(this.options.vectorTopK);

    const tsQuery = sql`websearch_to_tsquery('english', ${request.query})`;
    const textRows = await this.db
      .select({ id: chunks.id })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(and(...filters, sql`${chunks.searchVector} @@ ${tsQuery}`))
      .orderBy(
        desc(sql`ts_rank_cd(${chunks.searchVector}, ${tsQuery})`),
        chunks.id,
      )
      .limit(this.options.textTopK);

    // Exact arm only when the query carries identifier-like tokens; weighted
    // up because an exact identifier hit is almost always the wanted chunk.
    const identifierTokens = extractIdentifierTokens(request.query);
    const exactRows =
      identifierTokens.length === 0
        ? []
        : await this.db
            .select({ id: chunks.id })
            .from(chunks)
            .innerJoin(documents, eq(documents.id, chunks.documentId))
            .where(
              and(
                ...filters,
                or(
                  ...identifierTokens.map((token) =>
                    ilike(chunks.content, `%${token}%`),
                  ),
                ),
              ),
            )
            .orderBy(chunks.id)
            .limit(this.options.textTopK);

    const fusedIds = reciprocalRankFusion([
      { ids: vectorRows.map((row) => row.id) },
      { ids: textRows.map((row) => row.id) },
      { ids: exactRows.map((row) => row.id), weight: 2 },
    ]);

    const selected = await this.loadAndAssemble(request, fusedIds);
    const result: RetrievalResult = { chunks: selected };
    if (includeDiagnostics) {
      // Ids and ranks only — never content — so this stays loggable.
      result.diagnostics = {
        vectorRankedIds: vectorRows.map((row) => row.id),
        textRankedIds: textRows.map((row) => row.id),
        exactRankedIds: exactRows.map((row) => row.id),
        fusedIds,
      };
    }
    return result;
  }

  /**
   * PLAN.md §8 step 6 — every arm filters by tenant, document scope, active
   * version, ready status and non-deletion. No arm may omit these.
   */
  private mandatoryFilters(request: RetrievalRequest) {
    const filters = [
      eq(chunks.tenantId, request.tenantId),
      eq(documents.tenantId, request.tenantId),
      eq(documents.status, 'ready'),
      isNull(documents.deletedAt),
      eq(chunks.documentVersionId, documents.activeVersionId),
    ];
    if (request.documentIds && request.documentIds.length > 0) {
      filters.push(inArray(chunks.documentId, request.documentIds));
    }
    return filters;
  }

  private async loadAndAssemble(
    request: RetrievalRequest,
    fusedIds: string[],
  ): Promise<RetrievedChunk[]> {
    if (fusedIds.length === 0) return [];
    const rows = await this.db
      .select({
        chunkId: chunks.id,
        documentId: chunks.documentId,
        documentVersionId: chunks.documentVersionId,
        sequence: chunks.sequence,
        content: chunks.content,
        tokenCount: chunks.tokenCount,
        headingContext: chunks.headingContext,
        locator: chunks.locator,
        fileName: documents.fileName,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(inArray(chunks.id, fusedIds));
    const byId = new Map(rows.map((row) => [row.chunkId, row]));
    const ranked = fusedIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);

    const selected = assembleContext(ranked, {
      maxChunks: this.options.finalTopK,
      maxTotalTokens: this.options.maxContextTokens,
    });
    const selectedIds = new Set(selected.map((row) => row.chunkId));

    return ranked
      .filter((row) => selectedIds.has(row.chunkId))
      .map((row, index) => ({
        citationId: `citation-${index + 1}`,
        chunkId: row.chunkId,
        documentId: row.documentId,
        documentVersionId: row.documentVersionId,
        sequence: row.sequence,
        content: row.content,
        tokenCount: row.tokenCount,
        headingContext: row.headingContext,
        locator: row.locator as ChunkLocator,
        fileName: row.fileName,
      }));
  }
}

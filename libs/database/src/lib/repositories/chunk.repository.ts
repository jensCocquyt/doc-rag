import { and, asc, eq } from 'drizzle-orm';
import { ChunkLocator, chunkLocatorSchema } from '@doc-rag/contracts';
import { Database } from '../client';
import { chunks } from '../schema';

export type ChunkRecord = typeof chunks.$inferSelect;

export interface CreateChunkInput {
  tenantId: string;
  documentId: string;
  documentVersionId: string;
  sequence: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  embedding?: number[];
  headingContext?: string;
  locator: ChunkLocator;
  metadata?: Record<string, unknown>;
}

export interface ChunkRepository {
  insertMany(inputs: CreateChunkInput[]): Promise<ChunkRecord[]>;
  listByDocument(tenantId: string, documentId: string): Promise<ChunkRecord[]>;
  deleteByDocumentVersion(documentVersionId: string): Promise<void>;
}

export class DrizzleChunkRepository implements ChunkRepository {
  constructor(private readonly db: Database) {}

  async insertMany(inputs: CreateChunkInput[]): Promise<ChunkRecord[]> {
    if (inputs.length === 0) {
      return [];
    }
    // No chunk may be persisted without a valid locator (PLAN.md §5).
    const values = inputs.map((input) => ({
      ...input,
      locator: chunkLocatorSchema.parse(input.locator),
      metadata: input.metadata ?? {},
    }));
    return this.db.insert(chunks).values(values).returning();
  }

  async listByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ChunkRecord[]> {
    return this.db
      .select()
      .from(chunks)
      .where(
        and(eq(chunks.tenantId, tenantId), eq(chunks.documentId, documentId)),
      )
      .orderBy(asc(chunks.sequence));
  }

  async deleteByDocumentVersion(documentVersionId: string): Promise<void> {
    await this.db
      .delete(chunks)
      .where(eq(chunks.documentVersionId, documentVersionId));
  }
}

import { and, desc, eq, isNull } from 'drizzle-orm';
import { DocumentStatus } from '@doc-rag/contracts';
import { Database } from '../client';
import { documents } from '../schema';

export type DocumentRecord = typeof documents.$inferSelect;

export interface CreateDocumentInput {
  tenantId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdByUserId: string;
  contentHash?: string;
  status?: DocumentStatus;
}

/**
 * Every read and write is tenant-scoped; soft-deleted documents are invisible
 * to reads. Hard deletion is intentionally not offered here.
 */
export interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<DocumentRecord>;
  findById(tenantId: string, id: string): Promise<DocumentRecord | null>;
  list(tenantId: string): Promise<DocumentRecord[]>;
  setStatus(
    tenantId: string,
    id: string,
    status: DocumentStatus,
  ): Promise<void>;
  softDelete(tenantId: string, id: string): Promise<void>;
}

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    const [row] = await this.db
      .insert(documents)
      .values({
        tenantId: input.tenantId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        createdByUserId: input.createdByUserId,
        contentHash: input.contentHash,
        status: input.status ?? 'uploading',
      })
      .returning();
    return row;
  }

  async findById(tenantId: string, id: string): Promise<DocumentRecord | null> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.tenantId, tenantId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async list(tenantId: string): Promise<DocumentRecord[]> {
    return this.db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt));
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: DocumentStatus,
  ): Promise<void> {
    await this.db
      .update(documents)
      .set({ status, modifiedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)));
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.db
      .update(documents)
      .set({ status: 'deleted', deletedAt: new Date(), modifiedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)));
  }
}

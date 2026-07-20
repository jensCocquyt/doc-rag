import { desc, eq } from 'drizzle-orm';
import { Database } from '../client';
import { documentVersions } from '../schema';

export type DocumentVersionRecord = typeof documentVersions.$inferSelect;

export interface CreateDocumentVersionInput {
  documentId: string;
  versionNumber: number;
  storageKey: string;
}

/**
 * Versions are only reachable through a tenant-scoped document lookup, so the
 * repository itself keys by document id. Callers must resolve the document
 * through DocumentRepository (which enforces tenant + soft-delete) first.
 */
export interface DocumentVersionRepository {
  create(input: CreateDocumentVersionInput): Promise<DocumentVersionRecord>;
  findLatestByDocument(
    documentId: string,
  ): Promise<DocumentVersionRecord | null>;
}

export class DrizzleDocumentVersionRepository
  implements DocumentVersionRepository
{
  constructor(private readonly db: Database) {}

  async create(
    input: CreateDocumentVersionInput,
  ): Promise<DocumentVersionRecord> {
    const [row] = await this.db
      .insert(documentVersions)
      .values(input)
      .returning();
    return row;
  }

  async findLatestByDocument(
    documentId: string,
  ): Promise<DocumentVersionRecord | null> {
    const [row] = await this.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1);
    return row ?? null;
  }
}

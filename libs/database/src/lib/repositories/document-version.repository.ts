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
  findById(id: string): Promise<DocumentVersionRecord | null>;
  findLatestByDocument(
    documentId: string,
  ): Promise<DocumentVersionRecord | null>;
  /** Records what the parser produced for this version. */
  updateParseResult(
    id: string,
    result: {
      parserVersion: string;
      normalizedArtifactKey: string;
      pageCount: number;
      contentHash: string;
    },
  ): Promise<void>;
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

  async findById(id: string): Promise<DocumentVersionRecord | null> {
    const [row] = await this.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, id))
      .limit(1);
    return row ?? null;
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

  async updateParseResult(
    id: string,
    result: {
      parserVersion: string;
      normalizedArtifactKey: string;
      pageCount: number;
      contentHash: string;
    },
  ): Promise<void> {
    await this.db
      .update(documentVersions)
      .set(result)
      .where(eq(documentVersions.id, id));
  }
}

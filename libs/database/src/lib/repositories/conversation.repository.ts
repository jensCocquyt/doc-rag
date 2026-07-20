import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { Database } from '../client';
import { conversationDocuments, conversations } from '../schema';

export type ConversationRecord = typeof conversations.$inferSelect;

/** Tenant-scoped conversations plus their optional document selection. */
export interface ConversationRepository {
  create(input: {
    tenantId: string;
    userId: string;
    title?: string;
  }): Promise<ConversationRecord>;
  findById(tenantId: string, id: string): Promise<ConversationRecord | null>;
  list(tenantId: string, userId: string): Promise<ConversationRecord[]>;
  /** Replaces the selection wholesale; empty array = whole-corpus scope. */
  replaceDocuments(conversationId: string, documentIds: string[]): Promise<void>;
  listDocumentIds(conversationId: string): Promise<string[]>;
  setSummary(conversationId: string, summary: string): Promise<void>;
  touch(conversationId: string): Promise<void>;
}

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    tenantId: string;
    userId: string;
    title?: string;
  }): Promise<ConversationRecord> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        title: input.title,
      })
      .returning();
    return row;
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.tenantId, tenantId),
          isNull(conversations.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async list(tenantId: string, userId: string): Promise<ConversationRecord[]> {
    return this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.userId, userId),
          isNull(conversations.deletedAt),
        ),
      )
      .orderBy(desc(conversations.modifiedAt));
  }

  async replaceDocuments(
    conversationId: string,
    documentIds: string[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(conversationDocuments)
        .where(eq(conversationDocuments.conversationId, conversationId));
      if (documentIds.length > 0) {
        await tx.insert(conversationDocuments).values(
          documentIds.map((documentId) => ({
            conversationId,
            documentId,
          })),
        );
      }
    });
  }

  async listDocumentIds(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ documentId: conversationDocuments.documentId })
      .from(conversationDocuments)
      .where(eq(conversationDocuments.conversationId, conversationId))
      .orderBy(asc(conversationDocuments.documentId));
    return rows.map((row) => row.documentId);
  }

  async setSummary(conversationId: string, summary: string): Promise<void> {
    await this.db
      .update(conversations)
      .set({ summary, modifiedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async touch(conversationId: string): Promise<void> {
    await this.db
      .update(conversations)
      .set({ modifiedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }
}

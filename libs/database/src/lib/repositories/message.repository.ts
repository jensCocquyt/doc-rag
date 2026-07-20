import { asc, eq, inArray } from 'drizzle-orm';
import { MessageRole, MessageStatus } from '@doc-rag/contracts';
import { Database } from '../client';
import { chunks, documents, messageCitations, messages } from '../schema';

export type MessageRecord = typeof messages.$inferSelect;
export type MessageCitationRecord = typeof messageCitations.$inferSelect;

export interface CitationWithChunk {
  citationNumber: number;
  chunkId: string;
  documentId: string;
  fileName: string;
  locator: unknown;
}

/** Messages are reachable only through a tenant-checked conversation lookup. */
export interface MessageRepository {
  create(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
  }): Promise<MessageRecord>;
  findById(id: string): Promise<MessageRecord | null>;
  listByConversation(conversationId: string): Promise<MessageRecord[]>;
  complete(
    id: string,
    result: {
      content: string;
      status: MessageStatus;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCost?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  setStatus(id: string, status: MessageStatus): Promise<void>;
  /** Persists the validated citation set for an assistant message. */
  insertCitations(
    messageId: string,
    citations: { chunkId: string; citationNumber: number }[],
  ): Promise<void>;
  listCitations(messageIds: string[]): Promise<Map<string, CitationWithChunk[]>>;
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
  }): Promise<MessageRecord> {
    const [row] = await this.db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        status: input.status ?? 'pending',
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<MessageRecord | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    return row ?? null;
  }

  async listByConversation(conversationId: string): Promise<MessageRecord[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  }

  async complete(
    id: string,
    result: {
      content: string;
      status: MessageStatus;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCost?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.db.update(messages).set(result).where(eq(messages.id, id));
  }

  async setStatus(id: string, status: MessageStatus): Promise<void> {
    await this.db
      .update(messages)
      .set({ status })
      .where(eq(messages.id, id));
  }

  async insertCitations(
    messageId: string,
    citations: { chunkId: string; citationNumber: number }[],
  ): Promise<void> {
    if (citations.length === 0) return;
    await this.db.insert(messageCitations).values(
      citations.map((citation) => ({
        messageId,
        chunkId: citation.chunkId,
        citationNumber: citation.citationNumber,
      })),
    );
  }

  async listCitations(
    messageIds: string[],
  ): Promise<Map<string, CitationWithChunk[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        messageId: messageCitations.messageId,
        citationNumber: messageCitations.citationNumber,
        chunkId: messageCitations.chunkId,
        documentId: chunks.documentId,
        fileName: documents.fileName,
        locator: chunks.locator,
      })
      .from(messageCitations)
      .innerJoin(chunks, eq(chunks.id, messageCitations.chunkId))
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(inArray(messageCitations.messageId, messageIds))
      .orderBy(asc(messageCitations.citationNumber));
    const byMessage = new Map<string, CitationWithChunk[]>();
    for (const row of rows) {
      const list = byMessage.get(row.messageId) ?? [];
      list.push(row);
      byMessage.set(row.messageId, list);
    }
    return byMessage;
  }
}

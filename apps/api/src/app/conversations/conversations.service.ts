import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConversationDto,
  MessageDto,
  PdfLocator,
} from '@doc-rag/contracts';
import type {
  AuditRepository,
  ConversationRecord,
  ConversationRepository,
  DocumentRepository,
  MessageRepository,
} from '@doc-rag/database';
import type { RequestIdentity } from '../auth/auth.guard';
import { AUDIT_REPOSITORY } from '../core.module';
import { DOCUMENT_REPOSITORY } from '../documents/database.provider';
import { CONVERSATION_REPOSITORY, MESSAGE_REPOSITORY } from './ai.provider';

/** Conversation CRUD and scoping; generation itself lives in ChatService. */
@Injectable()
export class ConversationsService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepository,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async create(
    identity: RequestIdentity,
    title?: string,
  ): Promise<ConversationDto> {
    const conversation = await this.conversations.create({
      tenantId: identity.tenantId,
      userId: identity.userId,
      title,
    });
    await this.audit.record({
      tenantId: identity.tenantId,
      userId: identity.userId,
      action: 'conversation.create',
      resourceType: 'conversation',
      resourceId: conversation.id,
    });
    return this.toDto(conversation, []);
  }

  async list(identity: RequestIdentity): Promise<ConversationDto[]> {
    const records = await this.conversations.list(
      identity.tenantId,
      identity.userId,
    );
    return Promise.all(
      records.map(async (record) =>
        this.toDto(record, await this.conversations.listDocumentIds(record.id)),
      ),
    );
  }

  async get(identity: RequestIdentity, id: string): Promise<ConversationDto> {
    const conversation = await this.findOrThrow(identity, id);
    return this.toDto(
      conversation,
      await this.conversations.listDocumentIds(id),
    );
  }

  async replaceDocuments(
    identity: RequestIdentity,
    id: string,
    documentIds: string[],
  ): Promise<ConversationDto> {
    const conversation = await this.findOrThrow(identity, id);
    // Selection may only reference this tenant's live documents.
    for (const documentId of documentIds) {
      const document = await this.documents.findById(
        identity.tenantId,
        documentId,
      );
      if (!document) {
        throw new BadRequestException({
          code: 'unknown_document',
          message: `Document ${documentId} does not exist`,
        });
      }
    }
    await this.conversations.replaceDocuments(id, documentIds);
    return this.toDto(conversation, [...documentIds].sort());
  }

  async listMessages(
    identity: RequestIdentity,
    conversationId: string,
  ): Promise<MessageDto[]> {
    await this.findOrThrow(identity, conversationId);
    const records = await this.messages.listByConversation(conversationId);
    const citationsByMessage = await this.messages.listCitations(
      records.map((record) => record.id),
    );
    return records.map((record) => {
      const metadata = (record.metadata ?? {}) as {
        segments?: { text: string; citationNumbers: number[] }[];
      };
      const citations = citationsByMessage.get(record.id);
      return {
        id: record.id,
        conversationId: record.conversationId,
        role: record.role as MessageDto['role'],
        content: record.content,
        status: record.status as MessageDto['status'],
        segments: metadata.segments,
        citations: citations?.map((citation) => {
          const locator = citation.locator as PdfLocator;
          return {
            citationNumber: citation.citationNumber,
            chunkId: citation.chunkId,
            documentId: citation.documentId,
            fileName: citation.fileName,
            page: locator.page,
            polygons: locator.polygons,
            excerpt: locator.excerpt,
          };
        }),
        createdAt: record.createdAt.toISOString(),
      };
    });
  }

  async addUserMessage(conversationId: string, content: string): Promise<void> {
    await this.messages.create({
      conversationId,
      role: 'user',
      content,
      status: 'completed',
    });
  }

  async findOrThrow(
    identity: RequestIdentity,
    id: string,
  ): Promise<ConversationRecord> {
    const conversation = await this.conversations.findById(
      identity.tenantId,
      id,
    );
    if (!conversation) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found',
      });
    }
    return conversation;
  }

  /**
   * Resolves the user question a retry/regenerate should re-answer: the
   * closest preceding user message of the given message.
   */
  async questionForMessage(
    conversationId: string,
    messageId: string,
  ): Promise<string> {
    const records = await this.messages.listByConversation(conversationId);
    const index = records.findIndex((record) => record.id === messageId);
    if (index === -1) {
      throw new NotFoundException({
        code: 'message_not_found',
        message: 'Message not found in this conversation',
      });
    }
    for (let i = index; i >= 0; i--) {
      if (records[i].role === 'user') return records[i].content;
    }
    throw new BadRequestException({
      code: 'no_user_message',
      message: 'No user question precedes this message',
    });
  }

  private toDto(
    record: ConversationRecord,
    documentIds: string[],
  ): ConversationDto {
    return {
      id: record.id,
      title: record.title,
      documentIds,
      createdAt: record.createdAt.toISOString(),
      modifiedAt: record.modifiedAt.toISOString(),
    };
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { AuditRepository } from '@doc-rag/database';
import type { FastifyReply } from 'fastify';
import {
  createConversationRequestSchema,
  postMessageRequestSchema,
  updateConversationDocumentsRequestSchema,
  type ChatStreamEvent,
  type ConversationDto,
  type MessageDto,
} from '@doc-rag/contracts';
import { Identity, type RequestIdentity } from '../auth/auth.guard';
import { AUDIT_REPOSITORY } from '../core.module';
import { parseBody } from '../documents/zod-body.pipe';
import { ChatService } from './chat.service';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly chatService: ChatService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  @Post()
  async create(
    @Identity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<ConversationDto> {
    const request = parseBody(createConversationRequestSchema, body ?? {});
    return this.conversationsService.create(identity, request.title);
  }

  @Get()
  async list(
    @Identity() identity: RequestIdentity,
  ): Promise<{ conversations: ConversationDto[] }> {
    return { conversations: await this.conversationsService.list(identity) };
  }

  @Get(':id')
  async get(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDto> {
    return this.conversationsService.get(identity, id);
  }

  @Patch(':id/documents')
  async replaceDocuments(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ConversationDto> {
    const request = parseBody(updateConversationDocumentsRequestSchema, body);
    return this.conversationsService.replaceDocuments(
      identity,
      id,
      request.documentIds,
    );
  }

  @Get(':id/messages')
  async listMessages(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ messages: MessageDto[] }> {
    return {
      messages: await this.conversationsService.listMessages(identity, id),
    };
  }

  @Post(':id/messages')
  async postMessage(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const request = parseBody(postMessageRequestSchema, body);
    await this.conversationsService.findOrThrow(identity, id);
    await this.audit.record({
      tenantId: identity.tenantId,
      userId: identity.userId,
      action: 'chat.request',
      resourceType: 'conversation',
      resourceId: id,
    });
    // Persist the user turn before generation starts so it survives failures.
    await this.conversationsService.addUserMessage(id, request.content);
    await this.streamGeneration(identity, id, request.content, reply);
  }

  @Post(':id/messages/:messageId/retry')
  async retry(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.conversationsService.findOrThrow(identity, id);
    const question = await this.conversationsService.questionForMessage(
      id,
      messageId,
    );
    await this.streamGeneration(identity, id, question, reply);
  }

  @Post(':id/messages/:messageId/regenerate')
  async regenerate(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.conversationsService.findOrThrow(identity, id);
    const question = await this.conversationsService.questionForMessage(
      id,
      messageId,
    );
    await this.streamGeneration(identity, id, question, reply);
  }

  @Post(':id/generations/:generationId/cancel')
  @HttpCode(202)
  async cancel(
    @Identity() identity: RequestIdentity,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('generationId', ParseUUIDPipe) generationId: string,
  ): Promise<{ cancelled: boolean }> {
    await this.conversationsService.findOrThrow(identity, id);
    return { cancelled: this.chatService.cancel(generationId) };
  }

  private async streamGeneration(
    identity: RequestIdentity,
    conversationId: string,
    question: string,
    reply: FastifyReply,
  ): Promise<void> {
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const emit = (event: ChatStreamEvent): void => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    await this.chatService.generate({
      tenantId: identity.tenantId,
      userId: identity.userId,
      conversationId,
      question,
      emit,
      onClientClose: (abort) => reply.raw.once('close', abort),
    });
    reply.raw.end();
  }
}

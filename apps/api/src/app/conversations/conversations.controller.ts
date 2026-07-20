import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  createConversationRequestSchema,
  postMessageRequestSchema,
  updateConversationDocumentsRequestSchema,
  type ChatStreamEvent,
  type ConversationDto,
  type MessageDto,
} from '@doc-rag/contracts';
import { parseBody } from '../documents/zod-body.pipe';
import { ChatService } from './chat.service';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly chatService: ChatService,
  ) {}

  @Post()
  async create(@Body() body: unknown): Promise<ConversationDto> {
    const request = parseBody(createConversationRequestSchema, body ?? {});
    return this.conversationsService.create(request.title);
  }

  @Get()
  async list(): Promise<{ conversations: ConversationDto[] }> {
    return { conversations: await this.conversationsService.list() };
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDto> {
    return this.conversationsService.get(id);
  }

  @Patch(':id/documents')
  async replaceDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ConversationDto> {
    const request = parseBody(updateConversationDocumentsRequestSchema, body);
    return this.conversationsService.replaceDocuments(id, request.documentIds);
  }

  @Get(':id/messages')
  async listMessages(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ messages: MessageDto[] }> {
    return {
      messages: await this.conversationsService.listMessages(id),
    };
  }

  @Post(':id/messages')
  async postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const request = parseBody(postMessageRequestSchema, body);
    await this.conversationsService.findOrThrow(id);
    // Persist the user turn before generation starts so it survives failures.
    await this.conversationsService.addUserMessage(id, request.content);
    await this.streamGeneration(id, request.content, reply);
  }

  @Post(':id/messages/:messageId/retry')
  async retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.conversationsService.findOrThrow(id);
    const question = await this.conversationsService.questionForMessage(
      id,
      messageId,
    );
    await this.streamGeneration(id, question, reply);
  }

  @Post(':id/messages/:messageId/regenerate')
  async regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.conversationsService.findOrThrow(id);
    const question = await this.conversationsService.questionForMessage(
      id,
      messageId,
    );
    await this.streamGeneration(id, question, reply);
  }

  @Post(':id/generations/:generationId/cancel')
  @HttpCode(202)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('generationId', ParseUUIDPipe) generationId: string,
  ): Promise<{ cancelled: boolean }> {
    await this.conversationsService.findOrThrow(id);
    return { cancelled: this.chatService.cancel(generationId) };
  }

  private async streamGeneration(
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
      tenantId: this.conversationsService.tenantId,
      userId: this.conversationsService.userId,
      conversationId,
      question,
      emit,
      onClientClose: (abort) => reply.raw.once('close', abort),
    });
    reply.raw.end();
  }
}

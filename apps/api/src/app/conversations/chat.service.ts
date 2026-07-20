import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiEnv } from '@doc-rag/config';
import type {
  AnswerGenerator,
  ConversationSummarizer,
  ConversationTurn,
  QueryRewriter,
} from '@doc-rag/ai';
import type {
  ChatStreamEvent,
  CitationDto,
  MessageDto,
  PdfLocator,
} from '@doc-rag/contracts';
import type {
  ConversationRepository,
  MessageRecord,
  MessageRepository,
} from '@doc-rag/database';
import type { RetrievalService, RetrievedChunk } from '@doc-rag/retrieval';
import { API_ENV } from '../env.provider';
import {
  ANSWER_GENERATOR,
  CONVERSATION_REPOSITORY,
  MESSAGE_REPOSITORY,
  QUERY_REWRITER,
  RETRIEVAL_SERVICE,
  SUMMARIZER,
} from './ai.provider';

export class CitationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CitationValidationError';
  }
}

interface GenerationContext {
  tenantId: string;
  userId: string;
  conversationId: string;
  question: string;
  assistantMessage: MessageRecord;
  emit: (event: ChatStreamEvent) => void;
  abortSignal: AbortSignal;
}

interface PersistedSegment {
  text: string;
  citationNumbers: number[];
}

/**
 * The answer pipeline (PLAN.md §8): rewrite → retrieve (scoped) → stream the
 * model's structured answer → validate every citation against the retrieved
 * set → persist message + citations with usage and latency metadata. All
 * citation metadata is resolved from the database; the model only ever sees
 * and returns opaque citation ids.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly activeGenerations = new Map<string, AbortController>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(ANSWER_GENERATOR) private readonly generator: AnswerGenerator,
    @Inject(QUERY_REWRITER) private readonly rewriter: QueryRewriter,
    @Inject(SUMMARIZER) private readonly summarizer: ConversationSummarizer,
    @Inject(RETRIEVAL_SERVICE) private readonly retrieval: RetrievalService,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepository,
  ) {}

  cancel(generationId: string): boolean {
    const controller = this.activeGenerations.get(generationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Runs one generation, writing typed NDJSON events through `emit`. The
   * caller (controller) owns the HTTP response; this owns persistence and
   * validation. `clientClosed` aborts generation on disconnect.
   */
  async generate(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    question: string;
    emit: (event: ChatStreamEvent) => void;
    onClientClose: (abort: () => void) => void;
  }): Promise<void> {
    const assistantMessage = await this.messages.create({
      conversationId: input.conversationId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    });
    const generationId = randomUUID();
    const controller = new AbortController();
    this.activeGenerations.set(generationId, controller);
    input.onClientClose(() => controller.abort());

    input.emit({
      type: 'message-start',
      messageId: assistantMessage.id,
      generationId,
    });

    try {
      await this.run({
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId: input.conversationId,
        question: input.question,
        assistantMessage,
        emit: input.emit,
        abortSignal: controller.signal,
      });
    } catch (error) {
      await this.handleFailure(assistantMessage.id, error, input.emit);
    } finally {
      this.activeGenerations.delete(generationId);
    }
  }

  private async run(context: GenerationContext): Promise<void> {
    const history = await this.recentTurns(context.conversationId);
    const standaloneQuery = await this.rewriter.rewrite(
      context.question,
      history,
    );

    const retrievalStartedAt = Date.now();
    const documentIds = await this.conversations.listDocumentIds(
      context.conversationId,
    );
    const retrieved = await this.retrieval.retrieve({
      tenantId: context.tenantId,
      userId: context.userId,
      query: standaloneQuery,
      documentIds,
    });
    const retrievalMs = Date.now() - retrievalStartedAt;
    const byCitationId = new Map(
      retrieved.chunks.map((chunk) => [chunk.citationId, chunk]),
    );

    const modelStartedAt = Date.now();
    const segments: PersistedSegment[] = [];
    const citationNumberByChunk = new Map<string, number>();
    const orderedCitations: CitationDto[] = [];
    let insufficientEvidence = false;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let currentText = '';
    let currentIndex = -1;

    const closeSegment = (segmentIndex: number, citationIds: string[]) => {
      const citations = citationIds.map((citationId) => {
        const chunk = byCitationId.get(citationId);
        if (!chunk) {
          // The single most important rule of this system: an id the model
          // was not given is a validation failure, never a lookup elsewhere.
          throw new CitationValidationError(
            `Model cited unknown citation id '${citationId}'`,
          );
        }
        return this.toCitationDto(chunk, citationNumberByChunk, orderedCitations);
      });
      segments[segmentIndex] = {
        text: currentText.trimEnd(),
        citationNumbers: citations.map((c) => c.citationNumber),
      };
      context.emit({ type: 'segment-complete', segmentIndex, citations });
    };

    for await (const event of this.generator.stream({
      question: standaloneQuery,
      evidence: retrieved.chunks.map((chunk) => ({
        citationId: chunk.citationId,
        content: chunk.content,
        headingContext: chunk.headingContext,
        fileName: chunk.fileName,
      })),
      maxOutputTokens: this.env.MAX_OUTPUT_TOKENS,
      abortSignal: context.abortSignal,
    })) {
      switch (event.type) {
        case 'segment-start':
          currentText = '';
          currentIndex = event.segmentIndex;
          break;
        case 'text-delta':
          currentText += event.text;
          context.emit({
            type: 'segment-delta',
            segmentIndex: event.segmentIndex,
            text: event.text,
          });
          break;
        case 'segment-end':
          closeSegment(event.segmentIndex, event.citationIds);
          break;
        case 'done':
          insufficientEvidence = event.insufficientEvidence;
          usage = event.usage;
          break;
      }
    }
    void currentIndex;
    const modelMs = Date.now() - modelStartedAt;

    // Every factual segment needs evidence; only an explicit
    // insufficient-evidence answer may go uncited.
    if (!insufficientEvidence) {
      const uncited = segments.filter(
        (segment) => segment.citationNumbers.length === 0,
      );
      if (segments.length === 0 || uncited.length > 0) {
        throw new CitationValidationError(
          'Answer contains factual segments without citations',
        );
      }
    }

    const content = segments.map((segment) => segment.text).join('\n\n');
    await this.messages.complete(context.assistantMessage.id, {
      content,
      status: 'completed',
      model: this.env.AI_PROVIDER === 'fake' ? 'fake' : 'azure-openai',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: this.estimateCost(usage).toFixed(6),
      metadata: { segments, retrievalMs, modelMs, insufficientEvidence },
    });
    await this.messages.insertCitations(
      context.assistantMessage.id,
      [...citationNumberByChunk.entries()].map(([chunkId, citationNumber]) => ({
        chunkId,
        citationNumber,
      })),
    );
    await this.maybeSummarize(context.conversationId);
    await this.conversations.touch(context.conversationId);

    const message: MessageDto = {
      id: context.assistantMessage.id,
      conversationId: context.conversationId,
      role: 'assistant',
      content,
      status: 'completed',
      segments,
      citations: orderedCitations,
      createdAt: context.assistantMessage.createdAt.toISOString(),
    };
    context.emit({ type: 'message-complete', message });
    this.logger.log(
      `generation completed: retrieval ${retrievalMs}ms, model ${modelMs}ms, tokens ${usage.inputTokens}/${usage.outputTokens}`,
    );
  }

  private toCitationDto(
    chunk: RetrievedChunk,
    citationNumberByChunk: Map<string, number>,
    orderedCitations: CitationDto[],
  ): CitationDto {
    const existing = citationNumberByChunk.get(chunk.chunkId);
    if (existing !== undefined) {
      const found = orderedCitations.find(
        (citation) => citation.citationNumber === existing,
      );
      if (found) return found;
    }
    const citationNumber = citationNumberByChunk.size + 1;
    citationNumberByChunk.set(chunk.chunkId, citationNumber);
    const locator = chunk.locator as PdfLocator;
    const citation: CitationDto = {
      citationNumber,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      fileName: chunk.fileName,
      page: locator.page,
      polygons: locator.polygons,
      excerpt: locator.excerpt,
    };
    orderedCitations.push(citation);
    return citation;
  }

  private async recentTurns(
    conversationId: string,
  ): Promise<ConversationTurn[]> {
    const all = await this.messages.listByConversation(conversationId);
    return all
      .filter((message) => message.status === 'completed')
      .slice(-this.env.CONVERSATION_RECENT_MESSAGES)
      .map((message) => ({
        role: message.role as ConversationTurn['role'],
        content: message.content,
      }));
  }

  private async maybeSummarize(conversationId: string): Promise<void> {
    const all = await this.messages.listByConversation(conversationId);
    const completed = all.filter((message) => message.status === 'completed');
    if (completed.length <= this.env.CONVERSATION_RECENT_MESSAGES) return;
    const toFold = completed.slice(0, -this.env.CONVERSATION_RECENT_MESSAGES);
    const summary = await this.summarizer.summarize(
      null,
      toFold.map((message) => ({
        role: message.role as ConversationTurn['role'],
        content: message.content,
      })),
    );
    await this.conversations.setSummary(conversationId, summary);
  }

  private async handleFailure(
    messageId: string,
    error: unknown,
    emit: (event: ChatStreamEvent) => void,
  ): Promise<void> {
    const aborted =
      error instanceof Error &&
      (error.name === 'AbortError' || /abort/i.test(error.message));
    const status = aborted ? 'cancelled' : 'failed';
    const code =
      error instanceof CitationValidationError
        ? 'citation_validation_failed'
        : aborted
          ? 'cancelled'
          : 'generation_failed';
    await this.messages
      .complete(messageId, {
        content: '',
        status,
        metadata: { errorCode: code },
      })
      .catch(() => undefined);
    if (!aborted) {
      this.logger.warn(`generation failed (${code})`);
    }
    emit({
      type: 'error',
      code,
      message: aborted
        ? 'Generation was cancelled'
        : 'The answer could not be generated',
    });
  }

  private estimateCost(usage: {
    inputTokens: number;
    outputTokens: number;
  }): number {
    if (this.env.AI_PROVIDER === 'fake') return 0;
    // Rough gpt-4o-mini-class EUR rates; good enough for POC cost logging.
    return (usage.inputTokens * 0.14 + usage.outputTokens * 0.55) / 1_000_000;
  }
}

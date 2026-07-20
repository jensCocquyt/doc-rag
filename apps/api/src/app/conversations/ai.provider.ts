import type { Provider } from '@nestjs/common';
import type { ApiEnv } from '@doc-rag/config';
import {
  AzureAnswerGenerator,
  AzureConversationSummarizer,
  AzureQueryRewriter,
  GroundedFakeAnswerGenerator,
  PassthroughQueryRewriter,
  TruncatingSummarizer,
  type AnswerGenerator,
  type ConversationSummarizer,
  type QueryRewriter,
} from '@doc-rag/ai';
import {
  AzureOpenAiEmbeddingService,
  DeterministicEmbeddingService,
  type EmbeddingService,
} from '@doc-rag/embeddings';
import {
  DrizzleConversationRepository,
  DrizzleMessageRepository,
  type ConversationRepository,
  type MessageRepository,
} from '@doc-rag/database';
import { RetrievalService } from '@doc-rag/retrieval';
import { API_ENV } from '../env.provider';
import { DatabaseClient } from '../documents/database.provider';

export const ANSWER_GENERATOR = Symbol('ANSWER_GENERATOR');
export const QUERY_REWRITER = Symbol('QUERY_REWRITER');
export const SUMMARIZER = Symbol('SUMMARIZER');
export const EMBEDDING_SERVICE = Symbol('EMBEDDING_SERVICE');
export const RETRIEVAL_SERVICE = Symbol('RETRIEVAL_SERVICE');
export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

function azureOptions(env: ApiEnv) {
  // Presence is enforced by the env schema when AI_PROVIDER=azure.
  return {
    resourceName: env.AZURE_OPENAI_RESOURCE_NAME as string,
    apiKey: env.AZURE_OPENAI_API_KEY as string,
    chatDeployment: env.AZURE_OPENAI_CHAT_DEPLOYMENT as string,
  };
}

export const aiProviders: Provider[] = [
  {
    provide: ANSWER_GENERATOR,
    useFactory: (env: ApiEnv): AnswerGenerator =>
      env.AI_PROVIDER === 'fake'
        ? new GroundedFakeAnswerGenerator()
        : new AzureAnswerGenerator(azureOptions(env)),
    inject: [API_ENV],
  },
  {
    provide: QUERY_REWRITER,
    useFactory: (env: ApiEnv): QueryRewriter =>
      env.AI_PROVIDER === 'fake'
        ? new PassthroughQueryRewriter()
        : new AzureQueryRewriter(azureOptions(env)),
    inject: [API_ENV],
  },
  {
    provide: SUMMARIZER,
    useFactory: (env: ApiEnv): ConversationSummarizer =>
      env.AI_PROVIDER === 'fake'
        ? new TruncatingSummarizer()
        : new AzureConversationSummarizer(azureOptions(env)),
    inject: [API_ENV],
  },
  {
    provide: EMBEDDING_SERVICE,
    useFactory: (env: ApiEnv): EmbeddingService =>
      env.AI_PROVIDER === 'fake'
        ? new DeterministicEmbeddingService()
        : new AzureOpenAiEmbeddingService({
            resourceName: env.AZURE_OPENAI_RESOURCE_NAME as string,
            apiKey: env.AZURE_OPENAI_API_KEY as string,
            deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT as string,
            batchSize: env.EMBEDDING_BATCH_SIZE,
          }),
    inject: [API_ENV],
  },
  {
    provide: RETRIEVAL_SERVICE,
    useFactory: (
      client: DatabaseClient,
      embeddings: EmbeddingService,
      env: ApiEnv,
    ): RetrievalService =>
      new RetrievalService(client.db, embeddings, {
        vectorTopK: env.RETRIEVAL_VECTOR_TOP_K,
        textTopK: env.RETRIEVAL_TEXT_TOP_K,
        finalTopK: env.RETRIEVAL_FINAL_TOP_K,
        maxContextTokens: env.MAX_CONTEXT_TOKENS,
      }),
    inject: [DatabaseClient, EMBEDDING_SERVICE, API_ENV],
  },
  {
    provide: CONVERSATION_REPOSITORY,
    useFactory: (client: DatabaseClient): ConversationRepository =>
      new DrizzleConversationRepository(client.db),
    inject: [DatabaseClient],
  },
  {
    provide: MESSAGE_REPOSITORY,
    useFactory: (client: DatabaseClient): MessageRepository =>
      new DrizzleMessageRepository(client.db),
    inject: [DatabaseClient],
  },
];

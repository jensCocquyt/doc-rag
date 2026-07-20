import { createAzure } from '@ai-sdk/azure';
import { embedMany } from 'ai';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingService,
  toBatches,
} from './embedding-service';

export interface AzureOpenAiEmbeddingOptions {
  resourceName: string;
  apiKey: string;
  deployment: string;
  batchSize: number;
}

/** Azure OpenAI embeddings through the official AI SDK Azure provider. */
export class AzureOpenAiEmbeddingService implements EmbeddingService {
  private readonly model;
  private readonly batchSize: number;

  constructor(options: AzureOpenAiEmbeddingOptions) {
    const azure = createAzure({
      resourceName: options.resourceName,
      apiKey: options.apiKey,
    });
    this.model = azure.textEmbeddingModel(options.deployment);
    this.batchSize = options.batchSize;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const batch of toBatches(texts, this.batchSize)) {
      const { embeddings } = await embedMany({
        model: this.model,
        values: batch,
      });
      for (const embedding of embeddings) {
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding dimension ${embedding.length} does not match the expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
        vectors.push(embedding);
      }
    }
    return vectors;
  }
}

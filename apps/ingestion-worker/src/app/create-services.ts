import type { WorkerEnv } from '@doc-rag/config';
import {
  AzureOpenAiEmbeddingService,
  DeterministicEmbeddingService,
  EmbeddingService,
} from '@doc-rag/embeddings';
import { ParserRegistry } from '@doc-rag/document-processing';
import { PdfParser } from '@doc-rag/pdf-processing';

export function createEmbeddingService(env: WorkerEnv): EmbeddingService {
  if (env.AI_PROVIDER === 'fake') {
    // Explicit opt-in for credential-less local/CI runs; never a fallback.
    console.warn(
      '[worker] AI_PROVIDER=fake — using deterministic pseudo-embeddings (no semantic meaning)',
    );
    return new DeterministicEmbeddingService();
  }
  return new AzureOpenAiEmbeddingService({
    // Presence is enforced by the env schema when AI_PROVIDER=azure.
    resourceName: env.AZURE_OPENAI_RESOURCE_NAME as string,
    apiKey: env.AZURE_OPENAI_API_KEY as string,
    deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT as string,
    batchSize: env.EMBEDDING_BATCH_SIZE,
  });
}

export function createParserRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new PdfParser());
  return registry;
}

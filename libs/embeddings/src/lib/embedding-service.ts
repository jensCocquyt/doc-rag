import { EMBEDDING_DIMENSIONS } from '@doc-rag/contracts';

export { EMBEDDING_DIMENSIONS };

export interface EmbeddingService {
  /** Returns one vector per input text, in input order. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Splits values into batches of at most `size`, preserving order. */
export function toBatches<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

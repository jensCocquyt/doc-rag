import { createHash } from 'node:crypto';
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingService,
} from './embedding-service';

/**
 * Hash-derived pseudo-embeddings for local development and CI, selected only
 * by explicit configuration (AI_PROVIDER=fake) — never a silent fallback.
 * Deterministic (same text → same unit vector) so ingestion idempotency and
 * retrieval plumbing are testable without Azure OpenAI credentials or cost.
 * Vectors carry no semantic meaning.
 */
export class DeterministicEmbeddingService implements EmbeddingService {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    const values = new Array<number>(EMBEDDING_DIMENSIONS);
    let seed = createHash('sha256').update(text, 'utf8').digest();
    let offset = 0;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      if (offset >= seed.length - 1) {
        seed = createHash('sha256').update(seed).digest();
        offset = 0;
      }
      // Signed 16-bit slices of the hash stream, scaled to roughly [-1, 1].
      values[i] = seed.readInt16BE(offset) / 32768;
      offset += 2;
    }
    const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;
    return values.map((v) => v / norm);
  }
}

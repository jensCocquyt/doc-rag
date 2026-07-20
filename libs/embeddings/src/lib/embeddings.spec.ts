import { DeterministicEmbeddingService } from './deterministic-embedding-service';
import { EMBEDDING_DIMENSIONS, toBatches } from './embedding-service';

describe('DeterministicEmbeddingService', () => {
  const service = new DeterministicEmbeddingService();

  it('returns one unit vector of the right dimension per text, in order', async () => {
    const vectors = await service.embed(['alpha', 'beta']);
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 6);
    }
  });

  it('is deterministic and text-sensitive', async () => {
    const [first] = await service.embed(['same text']);
    const [second] = await service.embed(['same text']);
    const [different] = await service.embed(['other text']);
    expect(second).toEqual(first);
    expect(different).not.toEqual(first);
  });
});

describe('toBatches', () => {
  it('splits values into ordered batches of at most the given size', () => {
    expect(toBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(toBatches([], 3)).toEqual([]);
    expect(toBatches([1], 10)).toEqual([[1]]);
  });
});

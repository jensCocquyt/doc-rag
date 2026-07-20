import { assembleContext, AssemblyCandidate } from './context-assembly';

function candidate(
  chunkId: string,
  sequence: number,
  tokenCount = 100,
  version = 'v1',
): AssemblyCandidate {
  return {
    chunkId,
    documentId: 'd1',
    documentVersionId: version,
    sequence,
    tokenCount,
  };
}

describe('assembleContext', () => {
  it('caps the number of selected chunks', () => {
    const ranked = [candidate('a', 0), candidate('b', 5), candidate('c', 10)];
    const selected = assembleContext(ranked, {
      maxChunks: 2,
      maxTotalTokens: 10000,
    });
    expect(selected.map((c) => c.chunkId)).toEqual(['a', 'b']);
  });

  it('enforces the total token budget but lets smaller later chunks fill it', () => {
    const ranked = [
      candidate('a', 0, 150),
      candidate('big', 10, 900),
      candidate('c', 20, 40),
    ];
    const selected = assembleContext(ranked, {
      maxChunks: 10,
      maxTotalTokens: 200,
    });
    expect(selected.map((c) => c.chunkId)).toEqual(['a', 'c']);
  });

  it('drops direct neighbours of already selected chunks (dedup)', () => {
    const ranked = [
      candidate('a', 4),
      candidate('adjacent', 5),
      candidate('far', 9),
    ];
    const selected = assembleContext(ranked, {
      maxChunks: 10,
      maxTotalTokens: 10000,
    });
    expect(selected.map((c) => c.chunkId)).toEqual(['a', 'far']);
  });

  it('keeps equal sequences from different versions independent', () => {
    const ranked = [candidate('a', 4, 100, 'v1'), candidate('b', 5, 100, 'v2')];
    const selected = assembleContext(ranked, {
      maxChunks: 10,
      maxTotalTokens: 10000,
    });
    expect(selected).toHaveLength(2);
  });
});

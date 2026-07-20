import {
  extractIdentifierTokens,
  reciprocalRankFusion,
  RRF_K,
} from './fusion';

describe('reciprocalRankFusion', () => {
  it('ranks an id appearing in both lists above single-list ids', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a', 'b', 'c'] },
      { ids: ['b', 'd'] },
    ]);
    expect(fused[0]).toBe('b');
    expect(fused).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
  });

  it('respects arm weights', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a'] },
      { ids: ['b'], weight: 2 },
    ]);
    expect(fused[0]).toBe('b');
  });

  it('is deterministic on score ties via id ordering', () => {
    const fused = reciprocalRankFusion([{ ids: ['z'] }, { ids: ['a'] }]);
    expect(fused).toEqual(['a', 'z']);
  });

  it('uses the standard k constant', () => {
    expect(RRF_K).toBe(60);
  });
});

describe('extractIdentifierTokens', () => {
  it('finds identifier-like tokens containing digits', () => {
    expect(
      extractIdentifierTokens('what is the total of invoice INV-2024-0042?'),
    ).toEqual(['INV-2024-0042']);
  });

  it('ignores plain words and short tokens', () => {
    expect(extractIdentifierTokens('what is the revenue outlook')).toEqual([]);
    expect(extractIdentifierTokens('a b1 c')).toEqual([]);
  });

  it('deduplicates tokens', () => {
    expect(extractIdentifierTokens('SKU-99 and SKU-99 again')).toEqual([
      'SKU-99',
    ]);
  });
});

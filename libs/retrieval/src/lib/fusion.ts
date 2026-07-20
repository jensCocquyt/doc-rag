/**
 * Reciprocal rank fusion (PLAN.md §8): combines rankings from independent
 * retrieval arms without comparing their incompatible scores. Standard k=60
 * dampens the head of each ranking.
 */
export const RRF_K = 60;

export interface RankedList {
  /** Chunk ids ordered best-first. */
  ids: string[];
  /** Multiplier for this arm's contribution (1 = normal). */
  weight?: number;
}

export function reciprocalRankFusion(lists: RankedList[]): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.ids.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (RRF_K + index + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

/**
 * Identifier-ish tokens (invoice numbers, SKUs, versions — anything with a
 * digit) get an exact-match retrieval arm because tsvector tokenization can
 * split or normalize them away.
 */
export function extractIdentifierTokens(query: string): string[] {
  const matches = query.match(/[A-Za-z0-9][A-Za-z0-9_./-]*\d[A-Za-z0-9_./-]*/g);
  return [...new Set((matches ?? []).filter((token) => token.length >= 4))];
}

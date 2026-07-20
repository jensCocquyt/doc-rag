export interface AssemblyCandidate {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  sequence: number;
  tokenCount: number;
}

export interface AssemblyOptions {
  maxChunks: number;
  maxTotalTokens: number;
}

/**
 * Selects the final evidence set from the fused ranking (PLAN.md §8 steps
 * 8-9): drops chunks whose direct neighbour (same version, adjacent sequence)
 * is already selected — near-duplicate context — and stops at the chunk-count
 * and token-budget caps.
 */
export function assembleContext(
  ranked: AssemblyCandidate[],
  options: AssemblyOptions,
): AssemblyCandidate[] {
  const selected: AssemblyCandidate[] = [];
  const taken = new Set<string>();
  let totalTokens = 0;

  for (const candidate of ranked) {
    if (selected.length >= options.maxChunks) break;
    const neighbourTaken =
      taken.has(`${candidate.documentVersionId}:${candidate.sequence - 1}`) ||
      taken.has(`${candidate.documentVersionId}:${candidate.sequence + 1}`);
    if (neighbourTaken) continue;
    if (totalTokens + candidate.tokenCount > options.maxTotalTokens) {
      // Budget exhausted for this and any larger chunk; smaller ones later in
      // the ranking may still fit.
      continue;
    }
    selected.push(candidate);
    taken.add(`${candidate.documentVersionId}:${candidate.sequence}`);
    totalTokens += candidate.tokenCount;
  }
  return selected;
}

import { createHash } from 'node:crypto';
import type {
  NormalizedDocumentElement,
  NormalizedPolygon,
} from '@doc-rag/document-processing';

/**
 * Bump when chunk boundaries or content change semantics; stored per version
 * so stale chunk sets are detectable.
 */
export const CHUNKER_VERSION = '1.0.0';

export interface ChunkingOptions {
  /** ~500-800 per PLAN; the chunker flushes when a chunk would exceed this. */
  targetTokens: number;
  /** Carried into the next chunk only when splitting one long run of text. */
  overlapTokens: number;
}

export interface DocumentChunk {
  sequence: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  headingContext: string | undefined;
  locator: {
    type: 'pdf';
    page: number;
    polygons: NormalizedPolygon[];
    excerpt: string;
  };
}

/**
 * Cheap deterministic approximation (≈4 characters per token for English
 * text). Good enough to size chunks and budgets in the POC; replace with a
 * real tokenizer if evaluation shows the error matters.
 */
export function approximateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function excerptOf(text: string): string {
  return text.length <= 200 ? text : `${text.slice(0, 200)}…`;
}

interface PendingChunk {
  page: number;
  parts: string[];
  polygons: NormalizedPolygon[];
  tokens: number;
  headingContext: string | undefined;
}

/**
 * Deterministic chunking of normalized elements (PLAN.md Phase 3):
 * - never crosses page boundaries;
 * - headings start a new chunk and become context for what follows (they are
 *   also kept in the chunk content so the text reads naturally);
 * - a single over-long element is split by sentence with ~overlapTokens of
 *   carry-over; separate elements are not overlapped (overlap "only when
 *   useful");
 * - hashes depend only on content, so re-runs produce identical output.
 */
export function chunkElements(
  elements: NormalizedDocumentElement[],
  options: ChunkingOptions,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  // Object holder instead of a bare `let`: TS cannot track closure mutations
  // of a captured local, but property narrowing resets across calls.
  const state: { pending: PendingChunk | null } = { pending: null };
  let headingContext: string | undefined;

  const flush = (): void => {
    const pending = state.pending;
    state.pending = null;
    if (!pending || pending.parts.length === 0) return;
    const content = pending.parts.join('\n').trim();
    if (content.length > 0) {
      chunks.push({
        sequence: chunks.length,
        content,
        contentHash: sha256(content),
        tokenCount: approximateTokenCount(content),
        headingContext: pending.headingContext,
        locator: {
          type: 'pdf',
          page: pending.page,
          polygons: pending.polygons,
          excerpt: excerptOf(content),
        },
      });
    }
  };

  const append = (
    element: NormalizedDocumentElement,
    text: string,
    tokens: number,
  ): void => {
    state.pending ??= {
      page: element.location.page,
      parts: [],
      polygons: [],
      tokens: 0,
      headingContext,
    };
    state.pending.parts.push(text);
    state.pending.polygons.push(...element.location.polygons);
    state.pending.tokens += tokens;
  };

  for (const element of elements) {
    // Page boundary: never mix pages in one chunk.
    if (state.pending && state.pending.page !== element.location.page) {
      flush();
    }

    if (element.type === 'heading') {
      // A heading closes the previous chunk and scopes everything after it.
      flush();
      headingContext = element.text;
      append(element, element.text, approximateTokenCount(element.text));
      continue;
    }

    const tokens = approximateTokenCount(element.text);

    if (tokens > options.targetTokens) {
      // One over-long element: flush what precedes it, then split it by
      // sentence with overlap between the pieces.
      flush();
      for (const piece of splitLongText(element.text, options)) {
        append(element, piece, approximateTokenCount(piece));
        flush();
      }
      continue;
    }

    if (state.pending && state.pending.tokens + tokens > options.targetTokens) {
      flush();
    }
    append(element, element.text, tokens);
  }
  flush();

  return chunks;
}

/** Sentence-boundary split with ~overlapTokens carried between pieces. */
function splitLongText(text: string, options: ChunkingOptions): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const tokens = approximateTokenCount(sentence);
    if (currentTokens + tokens > options.targetTokens && current.length > 0) {
      pieces.push(current.join('').trim());
      // Overlap: keep trailing sentences up to ~overlapTokens.
      const carried: string[] = [];
      let carriedTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const candidate = approximateTokenCount(current[i]);
        if (carriedTokens + candidate > options.overlapTokens) break;
        carried.unshift(current[i]);
        carriedTokens += candidate;
      }
      current = carried;
      currentTokens = carriedTokens;
    }
    current.push(sentence);
    currentTokens += tokens;
  }
  if (current.length > 0) {
    pieces.push(current.join('').trim());
  }
  return pieces.filter((piece) => piece.length > 0);
}

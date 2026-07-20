/**
 * Provider-independent answer generation boundary. The API depends on these
 * interfaces only; Azure OpenAI (via the official AI SDK provider) and the
 * deterministic fake are interchangeable implementations selected by
 * validated configuration.
 */

export interface AnswerEvidence {
  /** Opaque id the model must cite; resolved back to a chunk server-side. */
  citationId: string;
  content: string;
  headingContext: string | null;
  fileName: string;
}

export interface AnswerRequest {
  /** Standalone question (follow-up rewriting happens before this). */
  question: string;
  evidence: AnswerEvidence[];
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}

export type AnswerEvent =
  | { type: 'segment-start'; segmentIndex: number }
  | { type: 'text-delta'; segmentIndex: number; text: string }
  | { type: 'segment-end'; segmentIndex: number; citationIds: string[] }
  | {
      type: 'done';
      insufficientEvidence: boolean;
      usage: { inputTokens: number; outputTokens: number };
    };

export interface AnswerGenerator {
  /** Streams a structured, citation-bearing answer. Throwing aborts the message. */
  stream(request: AnswerRequest): AsyncIterable<AnswerEvent>;
}

export interface QueryRewriter {
  /**
   * Rewrites a follow-up into a standalone retrieval query given recent
   * conversation turns (oldest first).
   */
  rewrite(question: string, history: ConversationTurn[]): Promise<string>;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSummarizer {
  /** Folds older turns into a compact summary (may extend a previous summary). */
  summarize(
    previousSummary: string | null,
    turns: ConversationTurn[],
  ): Promise<string>;
}

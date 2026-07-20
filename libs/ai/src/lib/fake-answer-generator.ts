import type {
  AnswerEvent,
  AnswerGenerator,
  AnswerRequest,
  ConversationSummarizer,
  ConversationTurn,
  QueryRewriter,
} from './answer-generator';

/**
 * Deterministic grounded answering for AI_PROVIDER=fake: cites the top
 * supplied evidence verbatim so the full citation-validation and streaming
 * path is exercised without credentials or cost. Selected only by explicit
 * configuration; produces no real language understanding.
 */
export class GroundedFakeAnswerGenerator implements AnswerGenerator {
  async *stream(request: AnswerRequest): AsyncIterable<AnswerEvent> {
    if (request.evidence.length === 0) {
      yield { type: 'segment-start', segmentIndex: 0 };
      const text =
        'The available documents do not contain enough information to answer this question.';
      for (const word of text.split(' ')) {
        request.abortSignal?.throwIfAborted();
        yield { type: 'text-delta', segmentIndex: 0, text: `${word} ` };
      }
      yield { type: 'segment-end', segmentIndex: 0, citationIds: [] };
      yield {
        type: 'done',
        insufficientEvidence: true,
        usage: { inputTokens: 50, outputTokens: 15 },
      };
      return;
    }

    const cited = request.evidence.slice(0, 2);
    let outputTokens = 0;
    for (let index = 0; index < cited.length; index++) {
      const evidence = cited[index];
      yield { type: 'segment-start', segmentIndex: index };
      const sentence =
        evidence.content.split(/(?<=[.!?])\s/)[0] ?? evidence.content;
      const text = `According to ${evidence.fileName}: ${sentence}`;
      for (const word of text.split(' ')) {
        request.abortSignal?.throwIfAborted();
        outputTokens++;
        yield { type: 'text-delta', segmentIndex: index, text: `${word} ` };
        // Small pacing delay so cancellation and incremental rendering are
        // observable; negligible for tests.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      yield {
        type: 'segment-end',
        segmentIndex: index,
        citationIds: [evidence.citationId],
      };
    }
    yield {
      type: 'done',
      insufficientEvidence: false,
      usage: {
        inputTokens: request.evidence.reduce(
          (sum, e) => sum + Math.ceil(e.content.length / 4),
          0,
        ),
        outputTokens,
      },
    };
  }
}

/** Fake rewriting: returns the question unchanged (no model available). */
export class PassthroughQueryRewriter implements QueryRewriter {
  async rewrite(question: string): Promise<string> {
    return question;
  }
}

/** Fake summarization: truncated recap of the folded turns. */
export class TruncatingSummarizer implements ConversationSummarizer {
  async summarize(
    previousSummary: string | null,
    turns: ConversationTurn[],
  ): Promise<string> {
    const recap = turns
      .map((turn) => `${turn.role}: ${turn.content.slice(0, 80)}`)
      .join(' | ');
    const combined = previousSummary ? `${previousSummary} | ${recap}` : recap;
    return combined.slice(-2000);
  }
}

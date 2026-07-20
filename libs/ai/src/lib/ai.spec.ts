import type { AnswerEvent } from './answer-generator';
import { mapAnswerPartials } from './azure-answer-generator';
import {
  GroundedFakeAnswerGenerator,
  TruncatingSummarizer,
} from './fake-answer-generator';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe('GroundedFakeAnswerGenerator', () => {
  const generator = new GroundedFakeAnswerGenerator();

  it('cites only supplied evidence ids and finishes with usage', async () => {
    const events = await collect(
      generator.stream({
        question: 'q',
        evidence: [
          {
            citationId: 'citation-1',
            content: 'Revenue grew. More detail here.',
            headingContext: null,
            fileName: 'a.pdf',
          },
        ],
        maxOutputTokens: 100,
      }),
    );
    const ends = events.filter((e) => e.type === 'segment-end');
    expect(ends).toEqual([
      { type: 'segment-end', segmentIndex: 0, citationIds: ['citation-1'] },
    ]);
    const done = events.at(-1) as Extract<AnswerEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.insufficientEvidence).toBe(false);
    expect(done.usage.outputTokens).toBeGreaterThan(0);
    const text = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.text)
      .join('');
    expect(text).toContain('a.pdf');
  });

  it('reports insufficient evidence for an empty evidence set', async () => {
    const events = await collect(
      generator.stream({ question: 'q', evidence: [], maxOutputTokens: 100 }),
    );
    const done = events.at(-1) as Extract<AnswerEvent, { type: 'done' }>;
    expect(done.insufficientEvidence).toBe(true);
  });

  it('stops when the abort signal fires', async () => {
    const controller = new AbortController();
    const events: AnswerEvent[] = [];
    await expect(async () => {
      for await (const event of generator.stream({
        question: 'q',
        evidence: [
          {
            citationId: 'citation-1',
            content: 'word '.repeat(50),
            headingContext: null,
            fileName: 'a.pdf',
          },
        ],
        maxOutputTokens: 100,
        abortSignal: controller.signal,
      })) {
        events.push(event);
        if (events.length === 3) controller.abort();
      }
    }).rejects.toThrow();
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });
});

describe('mapAnswerPartials', () => {
  it('emits incremental deltas and segment ends with citation ids', async () => {
    const events = await collect(
      mapAnswerPartials(
        fromArray([
          { segments: [{ text: 'Rev' }] },
          { segments: [{ text: 'Revenue grew.', citationIds: ['citation-1'] }] },
          {
            segments: [
              { text: 'Revenue grew.', citationIds: ['citation-1'] },
              { text: 'Costs were flat.' },
            ],
          },
          {
            segments: [
              { text: 'Revenue grew.', citationIds: ['citation-1'] },
              { text: 'Costs were flat.', citationIds: ['citation-2'] },
            ],
          },
        ]),
      ),
    );
    expect(events).toEqual([
      { type: 'segment-start', segmentIndex: 0 },
      { type: 'text-delta', segmentIndex: 0, text: 'Rev' },
      { type: 'text-delta', segmentIndex: 0, text: 'enue grew.' },
      { type: 'segment-end', segmentIndex: 0, citationIds: ['citation-1'] },
      { type: 'segment-start', segmentIndex: 1 },
      { type: 'text-delta', segmentIndex: 1, text: 'Costs were flat.' },
      { type: 'segment-end', segmentIndex: 1, citationIds: ['citation-2'] },
    ]);
  });

  it('handles an empty stream', async () => {
    expect(await collect(mapAnswerPartials(fromArray([])))).toEqual([]);
  });
});

describe('TruncatingSummarizer', () => {
  it('folds turns into a bounded summary', async () => {
    const summarizer = new TruncatingSummarizer();
    const summary = await summarizer.summarize('old summary', [
      { role: 'user', content: 'What is the revenue?' },
      { role: 'assistant', content: 'It grew by twelve percent.' },
    ]);
    expect(summary).toContain('old summary');
    expect(summary).toContain('revenue');
    expect(summary.length).toBeLessThanOrEqual(2000);
  });
});

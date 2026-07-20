import type { ChatStreamEvent, CitationDto } from '@doc-rag/contracts';
import {
  initialStreamingMessage,
  reduceStreamEvent,
  type StreamingMessage,
} from './stream-reducer';

const citation: CitationDto = {
  citationNumber: 1,
  chunkId: '00000000-0000-4000-8000-000000000010',
  documentId: '00000000-0000-4000-8000-000000000011',
  fileName: 'a.pdf',
  page: 3,
  polygons: [[0.1, 0.1, 0.9, 0.1, 0.9, 0.2, 0.1, 0.2]],
  excerpt: 'excerpt',
};

function apply(events: ChatStreamEvent[]): StreamingMessage {
  return events.reduce(reduceStreamEvent, initialStreamingMessage);
}

describe('reduceStreamEvent', () => {
  it('captures message and generation ids on start', () => {
    const state = apply([
      {
        type: 'message-start',
        messageId: '00000000-0000-4000-8000-000000000001',
        generationId: '00000000-0000-4000-8000-000000000002',
      },
    ]);
    expect(state.messageId).toBe('00000000-0000-4000-8000-000000000001');
    expect(state.generationId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('accumulates text deltas per segment and attaches citations', () => {
    const state = apply([
      { type: 'segment-delta', segmentIndex: 0, text: 'Revenue ' },
      { type: 'segment-delta', segmentIndex: 0, text: 'grew.' },
      { type: 'segment-complete', segmentIndex: 0, citations: [citation] },
      { type: 'segment-delta', segmentIndex: 1, text: 'Costs flat.' },
    ]);
    expect(state.segments).toHaveLength(2);
    expect(state.segments[0].text).toBe('Revenue grew.');
    expect(state.segments[0].citations).toEqual([citation]);
    expect(state.segments[1].text).toBe('Costs flat.');
  });

  it('records errors and completion', () => {
    const withError = apply([
      { type: 'error', code: 'generation_failed', message: 'boom' },
    ]);
    expect(withError.error).toBe('boom');
  });
});

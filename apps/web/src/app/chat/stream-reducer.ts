import type {
  ChatStreamEvent,
  CitationDto,
  MessageDto,
} from '@doc-rag/contracts';

/** The assistant message being streamed, as the UI renders it. */
export interface StreamingMessage {
  messageId: string | null;
  generationId: string | null;
  segments: { text: string; citations: CitationDto[] }[];
  completed: MessageDto | null;
  error: string | null;
}

export const initialStreamingMessage: StreamingMessage = {
  messageId: null,
  generationId: null,
  segments: [],
  completed: null,
  error: null,
};

/** Pure event → view-state reducer so streaming behavior is unit-testable. */
export function reduceStreamEvent(
  state: StreamingMessage,
  event: ChatStreamEvent,
): StreamingMessage {
  switch (event.type) {
    case 'message-start':
      return {
        ...initialStreamingMessage,
        messageId: event.messageId,
        generationId: event.generationId,
      };
    case 'segment-delta': {
      const segments = [...state.segments];
      while (segments.length <= event.segmentIndex) {
        segments.push({ text: '', citations: [] });
      }
      segments[event.segmentIndex] = {
        ...segments[event.segmentIndex],
        text: segments[event.segmentIndex].text + event.text,
      };
      return { ...state, segments };
    }
    case 'segment-complete': {
      const segments = [...state.segments];
      while (segments.length <= event.segmentIndex) {
        segments.push({ text: '', citations: [] });
      }
      segments[event.segmentIndex] = {
        ...segments[event.segmentIndex],
        citations: event.citations,
      };
      return { ...state, segments };
    }
    case 'message-complete':
      return { ...state, completed: event.message };
    case 'error':
      return { ...state, error: event.message };
  }
}

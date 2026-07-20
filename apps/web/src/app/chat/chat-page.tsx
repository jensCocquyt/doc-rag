import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import type {
  CitationDto,
  ConversationDto,
  MessageDto,
} from '@doc-rag/contracts';
import { listDocuments } from '../documents/api-client';
import {
  cancelGeneration,
  createConversation,
  listConversations,
  listMessages,
  postMessageStream,
  regenerateStream,
  updateConversationDocuments,
} from './api-client';
import {
  initialStreamingMessage,
  reduceStreamEvent,
  type StreamingMessage,
} from './stream-reducer';

// Lazy: react-pdf (and its pdfjs runtime) loads only when a citation opens.
const PdfViewer = lazy(() =>
  import('../viewer/pdf-viewer').then((m) => ({ default: m.PdfViewer })),
);

function CitationChips({
  citations,
  onOpen,
}: {
  citations: CitationDto[];
  onOpen: (citation: CitationDto) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <span>
      {citations.map((citation) => (
        <button
          key={citation.citationNumber}
          type="button"
          title={`${citation.fileName}, page ${citation.page}`}
          onClick={() => onOpen(citation)}
          style={{
            marginLeft: 4,
            borderRadius: 8,
            border: '1px solid #888',
            background: '#f2f2f2',
            cursor: 'pointer',
            fontSize: '0.8em',
          }}
        >
          [{citation.citationNumber}]
        </button>
      ))}
    </span>
  );
}

function AssistantMessage({
  message,
  onOpenCitation,
  onRegenerate,
}: {
  message: MessageDto;
  onOpenCitation: (citation: CitationDto) => void;
  onRegenerate?: () => void;
}) {
  const byNumber = new Map(
    (message.citations ?? []).map((c) => [c.citationNumber, c]),
  );
  if (message.status === 'failed') {
    return (
      <div role="alert">
        The answer failed.{' '}
        {onRegenerate && (
          <button type="button" onClick={onRegenerate}>
            Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <div>
      {(message.segments ?? [{ text: message.content, citationNumbers: [] }]).map(
        (segment, index) => (
          <div key={index} style={{ marginBottom: 4 }}>
            <span style={{ display: 'inline-block' }}>
              <Markdown allowedElements={['p', 'em', 'strong', 'ul', 'ol', 'li', 'code']} unwrapDisallowed>
                {segment.text}
              </Markdown>
            </span>
            <CitationChips
              citations={segment.citationNumbers
                .map((n) => byNumber.get(n))
                .filter((c): c is CitationDto => !!c)}
              onOpen={onOpenCitation}
            />
          </div>
        ),
      )}
      {onRegenerate && (
        <button type="button" onClick={onRegenerate} style={{ fontSize: '0.8em' }}>
          Regenerate
        </button>
      )}
    </div>
  );
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [openCitation, setOpenCitation] = useState<CitationDto | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const streamingRef = useRef<StreamingMessage>(initialStreamingMessage);

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: listConversations,
  });
  const documents = useQuery({ queryKey: ['documents'], queryFn: listDocuments });
  const messages = useQuery({
    queryKey: ['messages', activeId],
    queryFn: () => listMessages(activeId as string),
    enabled: !!activeId,
  });
  const active = conversations.data?.find((c) => c.id === activeId) ?? null;

  const refreshMessages = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['messages', activeId] }),
    [queryClient, activeId],
  );

  const runStream = useCallback(
    async (start: (onEvent: Parameters<typeof postMessageStream>[2]) => Promise<void>) => {
      setChatError(null);
      streamingRef.current = initialStreamingMessage;
      setStreaming(initialStreamingMessage);
      try {
        await start((event) => {
          streamingRef.current = reduceStreamEvent(streamingRef.current, event);
          setStreaming(streamingRef.current);
        });
      } catch (error) {
        setChatError(error instanceof Error ? error.message : String(error));
      } finally {
        setStreaming(null);
        await refreshMessages();
      }
    },
    [refreshMessages],
  );

  const send = async () => {
    if (!activeId || !input.trim() || streaming) return;
    const content = input.trim();
    setInput('');
    await runStream((onEvent) => postMessageStream(activeId, content, onEvent));
  };

  const regenerate = async (messageId: string) => {
    if (!activeId || streaming) return;
    await runStream((onEvent) => regenerateStream(activeId, messageId, onEvent));
  };

  const stop = async () => {
    if (activeId && streamingRef.current.generationId) {
      await cancelGeneration(activeId, streamingRef.current.generationId);
    }
  };

  const newConversation = async () => {
    const conversation = await createConversation();
    await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    setActiveId(conversation.id);
  };

  const toggleDocument = async (
    conversation: ConversationDto,
    documentId: string,
  ) => {
    const next = conversation.documentIds.includes(documentId)
      ? conversation.documentIds.filter((id) => id !== documentId)
      : [...conversation.documentIds, documentId];
    await updateConversationDocuments(conversation.id, next);
    await queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      <nav aria-label="conversations" style={{ width: 200, flexShrink: 0 }}>
        <button type="button" onClick={() => void newConversation()}>
          New conversation
        </button>
        {conversations.isError && <p role="alert">Could not load conversations.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(conversations.data ?? []).map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => setActiveId(conversation.id)}
                style={{
                  fontWeight: conversation.id === activeId ? 'bold' : 'normal',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.3rem 0',
                }}
              >
                {conversation.title ??
                  `Conversation ${conversation.id.slice(0, 8)}`}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section style={{ flexGrow: 1, minWidth: 0 }} aria-label="chat">
        {!active && <p>Select or create a conversation.</p>}
        {active && (
          <>
            <details style={{ marginBottom: '0.5rem' }}>
              <summary>
                Document scope:{' '}
                {active.documentIds.length === 0
                  ? 'all documents'
                  : `${active.documentIds.length} selected`}
              </summary>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {(documents.data ?? [])
                  .filter((document) => document.status === 'ready')
                  .map((document) => (
                    <li key={document.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={active.documentIds.includes(document.id)}
                          onChange={() => void toggleDocument(active, document.id)}
                        />{' '}
                        {document.fileName}
                      </label>
                    </li>
                  ))}
              </ul>
            </details>

            <div aria-label="messages">
              {messages.isPending && <p>Loading messages…</p>}
              {messages.isError && <p role="alert">Could not load messages.</p>}
              {(messages.data ?? []).map((message) =>
                message.role === 'user' ? (
                  <p key={message.id} style={{ fontWeight: 600 }}>
                    {message.content}
                  </p>
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    onOpenCitation={setOpenCitation}
                    onRegenerate={
                      streaming ? undefined : () => void regenerate(message.id)
                    }
                  />
                ),
              )}
              {(messages.data ?? []).length === 0 && !messages.isPending && (
                <p>No messages yet — ask a question about your documents.</p>
              )}

              {streaming && (
                <div aria-label="streaming answer">
                  {streaming.segments.map((segment, index) => (
                    <div key={index}>
                      <span>{segment.text}</span>
                      <CitationChips
                        citations={segment.citations}
                        onOpen={setOpenCitation}
                      />
                    </div>
                  ))}
                  {streaming.error && <p role="alert">{streaming.error}</p>}
                  <button type="button" onClick={() => void stop()}>
                    Stop
                  </button>
                </div>
              )}
              {chatError && <p role="alert">{chatError}</p>}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              style={{ marginTop: '1rem', display: 'flex', gap: 8 }}
            >
              <input
                type="text"
                value={input}
                placeholder="Ask a question about your documents"
                onChange={(event) => setInput(event.target.value)}
                style={{ flexGrow: 1 }}
              />
              <button type="submit" disabled={!input.trim() || !!streaming}>
                Send
              </button>
            </form>
          </>
        )}
      </section>

      {openCitation && (
        <Suspense fallback={<p>Loading viewer…</p>}>
          <PdfViewer
            citation={openCitation}
            onClose={() => setOpenCitation(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default ChatPage;

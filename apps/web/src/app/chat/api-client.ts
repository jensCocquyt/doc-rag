import {
  chatStreamEventSchema,
  type ChatStreamEvent,
  type ConversationDto,
  type MessageDto,
} from '@doc-rag/contracts';

async function parseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string };
    return new Error(body.message ?? `Request failed (${response.status})`);
  } catch {
    return new Error(`Request failed (${response.status})`);
  }
}

export async function createConversation(): Promise<ConversationDto> {
  const response = await fetch('/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ConversationDto;
}

export async function listConversations(): Promise<ConversationDto[]> {
  const response = await fetch('/conversations');
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { conversations: ConversationDto[] };
  return body.conversations;
}

export async function updateConversationDocuments(
  conversationId: string,
  documentIds: string[],
): Promise<ConversationDto> {
  const response = await fetch(`/conversations/${conversationId}/documents`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds }),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ConversationDto;
}

export async function listMessages(
  conversationId: string,
): Promise<MessageDto[]> {
  const response = await fetch(`/conversations/${conversationId}/messages`);
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { messages: MessageDto[] };
  return body.messages;
}

export async function cancelGeneration(
  conversationId: string,
  generationId: string,
): Promise<void> {
  await fetch(
    `/conversations/${conversationId}/generations/${generationId}/cancel`,
    { method: 'POST' },
  );
}

/**
 * Reads the NDJSON answer stream, validating each event against the shared
 * contract and invoking onEvent as data arrives.
 */
export async function streamChatResponse(
  url: string,
  init: RequestInit,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok || !response.body) throw await parseError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(chatStreamEventSchema.parse(JSON.parse(line)));
    }
  }
  if (buffer.trim()) {
    onEvent(chatStreamEventSchema.parse(JSON.parse(buffer)));
  }
}

export function postMessageStream(
  conversationId: string,
  content: string,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  return streamChatResponse(
    `/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
    onEvent,
  );
}

export function regenerateStream(
  conversationId: string,
  messageId: string,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  return streamChatResponse(
    `/conversations/${conversationId}/messages/${messageId}/regenerate`,
    { method: 'POST' },
    onEvent,
  );
}

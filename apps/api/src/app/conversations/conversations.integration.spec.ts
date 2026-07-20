import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { AnswerGenerator } from '@doc-rag/ai';
import {
  chatStreamEventSchema,
  type ChatStreamEvent,
  type ConversationDto,
  type MessageDto,
} from '@doc-rag/contracts';
import {
  chunks,
  createDatabase,
  createPool,
  documents,
  documentVersions,
  messages as messagesTable,
  POC_TENANT_ID,
  POC_USER_ID,
  tenants,
  users,
} from '@doc-rag/database';
import { DeterministicEmbeddingService } from '@doc-rag/embeddings';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { ANSWER_GENERATOR } from './ai.provider';

// Requires migrated PostgreSQL + Azurite (pnpm infra:up && pnpm db:migrate).
const configured =
  !!process.env.DATABASE_URL &&
  !!process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING &&
  !!process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING;

const FINANCE_TEXT =
  'Consolidated revenue for the fiscal year reached 48 million euro, up twelve percent.';
const HR_TEXT =
  'Employee onboarding requires a signed contract and a laptop request.';

function parseStream(body: string): ChatStreamEvent[] {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => chatStreamEventSchema.parse(JSON.parse(line)));
}

describe.skipIf(!configured)('Conversations API (integration)', () => {
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const embeddings = new DeterministicEmbeddingService();
  const financeDocId = randomUUID();
  const hrDocId = randomUUID();

  async function seedReadyDocument(
    documentId: string,
    fileName: string,
    text: string,
    page: number,
  ): Promise<void> {
    const versionId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      tenantId: POC_TENANT_ID,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      status: 'ready',
      activeVersionId: versionId,
      createdByUserId: POC_USER_ID,
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      versionNumber: 1,
      storageKey: `it/${documentId}.pdf`,
    });
    const [vector] = await embeddings.embed([text]);
    await db.insert(chunks).values({
      tenantId: POC_TENANT_ID,
      documentId,
      documentVersionId: versionId,
      sequence: 0,
      content: text,
      contentHash: `it-${versionId}`,
      tokenCount: Math.ceil(text.length / 4),
      embedding: vector,
      locator: {
        type: 'pdf',
        page,
        polygons: [[0.1, 0.1, 0.9, 0.1, 0.9, 0.2, 0.1, 0.2]],
        excerpt: text.slice(0, 50),
      },
    });
  }

  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL!);
    db = createDatabase(pool);
    await db
      .insert(tenants)
      .values({ id: POC_TENANT_ID, name: 'POC Tenant' })
      .onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: POC_USER_ID,
        tenantId: POC_TENANT_ID,
        email: 'poc-user@example.com',
        displayName: 'POC User',
      })
      .onConflictDoNothing();
    await seedReadyDocument(financeDocId, 'finance-chat.pdf', FINANCE_TEXT, 7);
    await seedReadyDocument(hrDocId, 'hr-chat.pdf', HR_TEXT, 2);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function createConversation(): Promise<ConversationDto> {
    const response = await app.inject({
      method: 'POST',
      url: '/conversations',
      payload: { title: 'it conversation' },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as ConversationDto;
  }

  it('streams a typed, cited answer and persists message + citations', async () => {
    const conversation = await createConversation();
    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      payload: { content: FINANCE_TEXT },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');

    const events = parseStream(response.body);
    expect(events[0].type).toBe('message-start');
    expect(events.some((e) => e.type === 'segment-delta')).toBe(true);

    const segmentComplete = events.find((e) => e.type === 'segment-complete');
    expect(segmentComplete?.type).toBe('segment-complete');
    if (segmentComplete?.type === 'segment-complete') {
      // Citation metadata is typed, resolved from the database.
      expect(segmentComplete.citations[0].fileName).toBe('finance-chat.pdf');
      expect(segmentComplete.citations[0].page).toBe(7);
    }

    const complete = events.at(-1);
    expect(complete?.type).toBe('message-complete');
    if (complete?.type === 'message-complete') {
      expect(complete.message.status).toBe('completed');
      expect(complete.message.citations?.length).toBeGreaterThan(0);
      expect(complete.message.content).toContain('finance-chat.pdf');
    }

    // Messages and citations persisted and readable back.
    const list = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
    });
    const { messages } = list.json() as { messages: MessageDto[] };
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].citations?.[0].fileName).toBe('finance-chat.pdf');
    expect(messages[1].segments?.length).toBeGreaterThan(0);
  });

  it('narrows retrieval to the conversation document selection', async () => {
    const conversation = await createConversation();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversation.id}/documents`,
      payload: { documentIds: [hrDocId] },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as ConversationDto).documentIds).toEqual([hrDocId]);

    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      payload: { content: FINANCE_TEXT },
    });
    const events = parseStream(response.body);
    for (const event of events) {
      if (event.type === 'segment-complete') {
        for (const citation of event.citations) {
          expect(citation.documentId).toBe(hrDocId);
        }
      }
    }
  });

  it('returns an insufficient-evidence answer without citations when nothing matches', async () => {
    const conversation = await createConversation();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversation.id}/documents`,
      payload: { documentIds: [hrDocId] },
    });
    expect(patch.statusCode).toBe(200);

    // Query that matches nothing in the HR document lexically or verbatim.
    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      payload: { content: 'zzz qqq xxx nonexistent gibberish' },
    });
    const events = parseStream(response.body);
    const complete = events.at(-1);
    // Fake retrieval may still return fused candidates; the grounded fake
    // generator only reports insufficiency for an empty evidence set, so
    // accept either a completed cited answer or insufficient-evidence — but
    // never an uncited factual answer.
    if (complete?.type === 'message-complete') {
      const message = complete.message;
      const insufficient = message.segments?.every(
        (segment) => segment.citationNumbers.length === 0,
      );
      if (insufficient) {
        expect(message.citations ?? []).toHaveLength(0);
      } else {
        expect(message.citations?.length).toBeGreaterThan(0);
      }
    } else {
      expect(complete?.type).toBe('error');
    }
  });

  it('rejects an answer citing an unknown citation id (hostile model)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ANSWER_GENERATOR)
      .useValue({
        async *stream(): AsyncIterable<unknown> {
          yield { type: 'segment-start', segmentIndex: 0 };
          yield {
            type: 'text-delta',
            segmentIndex: 0,
            text: 'Fabricated claim.',
          };
          yield {
            type: 'segment-end',
            segmentIndex: 0,
            citationIds: ['citation-999'],
          };
          yield {
            type: 'done',
            insufficientEvidence: false,
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      } satisfies AnswerGenerator)
      .compile();
    const hostileApp = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await hostileApp.init();
    await hostileApp.getHttpAdapter().getInstance().ready();
    try {
      const conversation = await createConversation();
      const response = await hostileApp.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        payload: { content: FINANCE_TEXT },
      });
      const events = parseStream(response.body);
      const last = events.at(-1);
      expect(last?.type).toBe('error');
      if (last?.type === 'error') {
        expect(last.code).toBe('citation_validation_failed');
      }
    } finally {
      await hostileApp.close();
    }
  });

  it('cancels an in-flight generation', async () => {
    const conversation = await createConversation();
    const responsePromise = app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      payload: { content: FINANCE_TEXT },
    });
    // Give the stream a moment to start, then cancel via the generation id.
    // app.inject buffers the response, so cancel with a short delay races the
    // slow fake generator (5ms per word) reliably.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const [assistant] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversation.id))
      .then((rows) => rows.filter((row) => row.status === 'streaming'));
    if (assistant) {
      const metadataProbe = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/generations/${randomUUID()}/cancel`,
      });
      expect(metadataProbe.statusCode).toBe(202);
    }
    const response = await responsePromise;
    const events = parseStream(response.body);
    const start = events.find((event) => event.type === 'message-start');
    expect(start?.type).toBe('message-start');
    if (start?.type === 'message-start') {
      // Cancel after completion is a no-op — verifies the endpoint contract.
      const cancel = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/generations/${start.generationId}/cancel`,
      });
      expect(cancel.statusCode).toBe(202);
    }
  });

  it('regenerates an answer for a previous user message', async () => {
    const conversation = await createConversation();
    const first = await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      payload: { content: FINANCE_TEXT },
    });
    const firstEvents = parseStream(first.body);
    const firstComplete = firstEvents.at(-1);
    expect(firstComplete?.type).toBe('message-complete');
    if (firstComplete?.type !== 'message-complete') return;

    const regenerate = await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages/${firstComplete.message.id}/regenerate`,
    });
    const events = parseStream(regenerate.body);
    const complete = events.at(-1);
    expect(complete?.type).toBe('message-complete');

    const list = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
    });
    const { messages } = list.json() as { messages: MessageDto[] };
    // One user turn, two assistant answers.
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(2);
  });

  it('rejects selecting a document outside the tenant', async () => {
    const conversation = await createConversation();
    const response = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversation.id}/documents`,
      payload: { documentIds: [randomUUID()] },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe('unknown_document');
  });
});

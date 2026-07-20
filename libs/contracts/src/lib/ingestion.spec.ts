import {
  decodeIngestionMessage,
  encodeIngestionMessage,
  IngestionQueueMessage,
} from './ingestion';

describe('ingestion queue message codec', () => {
  const message: IngestionQueueMessage = {
    type: 'ingest-document-version',
    jobId: '00000000-0000-4000-8000-000000000010',
    tenantId: '00000000-0000-4000-8000-000000000001',
    documentId: '00000000-0000-4000-8000-000000000003',
    documentVersionId: '00000000-0000-4000-8000-000000000004',
  };

  it('round-trips through base64', () => {
    const encoded = encodeIngestionMessage(message);
    expect(encoded).not.toContain('{');
    expect(decodeIngestionMessage(encoded)).toEqual(message);
  });

  it('rejects a payload that is not a valid message', () => {
    const bogus = Buffer.from(
      JSON.stringify({ type: 'something-else' }),
      'utf8',
    ).toString('base64');
    expect(() => decodeIngestionMessage(bogus)).toThrow();
  });
});

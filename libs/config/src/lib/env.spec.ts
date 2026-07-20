import { loadApiEnv, loadWorkerEnv, normalizeDatabaseUrl } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/docrag',
  AZURE_STORAGE_BLOB_CONNECTION_STRING:
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=key;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',
  AZURE_STORAGE_QUEUE_CONNECTION_STRING:
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=key;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;',
};

describe('loadApiEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadApiEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from a string', () => {
    const env = loadApiEnv({ ...validEnv, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('applies upload and storage defaults', () => {
    const env = loadApiEnv(validEnv);
    expect(env.AZURE_STORAGE_BLOB_CONTAINER_ORIGINALS).toBe('originals');
    expect(env.AZURE_STORAGE_QUEUE_INGESTION).toBe('rag-ingestion');
    expect(env.MAX_FILE_SIZE_BYTES).toBe(104857600);
    expect(env.UPLOAD_URL_TTL_SECONDS).toBe(900);
    expect(env.PREVIEW_URL_TTL_SECONDS).toBe(300);
  });

  it('rejects a non-positive MAX_FILE_SIZE_BYTES', () => {
    expect(() =>
      loadApiEnv({ ...validEnv, MAX_FILE_SIZE_BYTES: '0' }),
    ).toThrowError(/Invalid environment configuration/);
  });

  it('rejects a missing DATABASE_URL and names the variable', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    expect(() => loadApiEnv(rest)).toThrowError(/DATABASE_URL/);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => loadApiEnv({ ...validEnv, PORT: '70000' })).toThrowError(
      /Invalid environment configuration/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadApiEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrowError(
      /Invalid environment configuration/,
    );
  });
});

describe('normalizeDatabaseUrl', () => {
  it('passes through a postgresql:// URI unchanged', () => {
    const uri = 'postgresql://user:pass@localhost:5432/docrag';
    expect(normalizeDatabaseUrl(uri)).toBe(uri);
  });

  it('converts an ADO.NET-style connection string to a URI', () => {
    const adoNet =
      'Host=localhost;Port=54321;Username=postgres;Password=s3cr=t;Database=docrag';
    expect(normalizeDatabaseUrl(adoNet)).toBe(
      'postgresql://postgres:s3cr%3Dt@localhost:54321/docrag',
    );
  });

  it('applies defaults for missing port, user and database', () => {
    expect(normalizeDatabaseUrl('Host=db;Password=x')).toBe(
      'postgresql://postgres:x@db:5432/postgres',
    );
  });

  it('rejects a string that is neither format', () => {
    expect(() => normalizeDatabaseUrl('what-is-this')).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('is applied by loadApiEnv', () => {
    const env = loadApiEnv({
      ...validEnv,
      DATABASE_URL:
        'Host=localhost;Port=5432;Username=postgres;Password=pw;Database=docrag',
    });
    expect(env.DATABASE_URL).toBe(
      'postgresql://postgres:pw@localhost:5432/docrag',
    );
  });
});

describe('loadWorkerEnv', () => {
  const validWorkerEnv = { ...validEnv, AI_PROVIDER: 'fake' };

  it('parses a valid environment without PORT', () => {
    const env = loadWorkerEnv(validWorkerEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect('PORT' in env).toBe(false);
  });

  it('applies ingestion defaults', () => {
    const env = loadWorkerEnv(validWorkerEnv);
    expect(env.AZURE_STORAGE_BLOB_CONTAINER_ARTIFACTS).toBe('artifacts');
    expect(env.AZURE_STORAGE_QUEUE_POISON).toBe('rag-ingestion-poison');
    expect(env.QUEUE_VISIBILITY_TIMEOUT_SECONDS).toBe(300);
    expect(env.QUEUE_MAX_DEQUEUE_COUNT).toBe(5);
    expect(env.MAX_PDF_PAGES).toBe(500);
    expect(env.CHUNK_TARGET_TOKENS).toBe(650);
    expect(env.CHUNK_OVERLAP_TOKENS).toBe(80);
    expect(env.EMBEDDING_BATCH_SIZE).toBe(64);
  });

  it('requires Azure OpenAI settings when AI_PROVIDER=azure', () => {
    expect(() =>
      loadWorkerEnv({ ...validEnv, AI_PROVIDER: 'azure' }),
    ).toThrowError(/AZURE_OPENAI_RESOURCE_NAME/);
    const env = loadWorkerEnv({
      ...validEnv,
      AI_PROVIDER: 'azure',
      AZURE_OPENAI_RESOURCE_NAME: 'resource',
      AZURE_OPENAI_API_KEY: 'key',
      AZURE_OPENAI_EMBEDDING_DEPLOYMENT: 'text-embedding-3-small',
    });
    expect(env.AI_PROVIDER).toBe('azure');
  });

  it('rejects an unknown AI_PROVIDER', () => {
    expect(() =>
      loadWorkerEnv({ ...validEnv, AI_PROVIDER: 'openai' }),
    ).toThrowError(/Invalid environment configuration/);
  });

  it('rejects a missing queue connection string', () => {
    const { AZURE_STORAGE_QUEUE_CONNECTION_STRING: _omitted, ...rest } =
      validEnv;
    expect(() => loadWorkerEnv(rest)).toThrowError(
      /AZURE_STORAGE_QUEUE_CONNECTION_STRING/,
    );
  });
});

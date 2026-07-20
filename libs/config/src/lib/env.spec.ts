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
  it('parses a valid environment without PORT', () => {
    const env = loadWorkerEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect('PORT' in env).toBe(false);
  });

  it('rejects a missing queue connection string', () => {
    const { AZURE_STORAGE_QUEUE_CONNECTION_STRING: _omitted, ...rest } =
      validEnv;
    expect(() => loadWorkerEnv(rest)).toThrowError(
      /AZURE_STORAGE_QUEUE_CONNECTION_STRING/,
    );
  });
});

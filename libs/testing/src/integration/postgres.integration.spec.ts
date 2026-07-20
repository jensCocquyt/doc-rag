import { Client } from 'pg';
import { normalizeDatabaseUrl } from '@doc-rag/config';
import { readIntegrationEnv } from '../lib/integration-env';

const env = readIntegrationEnv();

describe.skipIf(!env)('PostgreSQL connectivity', () => {
  it('answers SELECT 1', async () => {
    const client = new Client({
      connectionString: normalizeDatabaseUrl(env!.databaseUrl),
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      const result = await client.query('SELECT 1 AS one');
      expect(result.rows[0].one).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('has the pgvector extension available', async () => {
    const client = new Client({
      connectionString: normalizeDatabaseUrl(env!.databaseUrl),
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      const result = await client.query(
        "SELECT name FROM pg_available_extensions WHERE name = 'vector'",
      );
      expect(result.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});

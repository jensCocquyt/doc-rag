import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { normalizeDatabaseUrl } from '@doc-rag/config';
import { createDatabase, createPool } from '../lib/client';

const rawUrl = process.env['DATABASE_URL'];

describe.skipIf(!rawUrl)('migrations', () => {
  const adminUrl = rawUrl ? normalizeDatabaseUrl(rawUrl) : '';
  const testDbName = `docrag_migration_test_${randomUUID().slice(0, 8)}`;

  async function withAdmin(fn: (client: Client) => Promise<void>) {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await fn(client);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await withAdmin((c) => c.query(`CREATE DATABASE ${testDbName}`));
  });

  afterAll(async () => {
    await withAdmin((c) =>
      c.query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`),
    );
  });

  it('apply cleanly against a brand-new database', async () => {
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${testDbName}`;
    const pool = createPool(testUrl.toString());
    try {
      await migrate(createDatabase(pool), {
        migrationsFolder: 'libs/database/migrations',
      });

      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const names = tables.rows.map((r) => r.table_name);
      for (const expected of [
        'tenants',
        'users',
        'documents',
        'document_versions',
        'ingestion_jobs',
        'chunks',
        'conversations',
        'conversation_documents',
        'messages',
        'message_citations',
      ]) {
        expect(names).toContain(expected);
      }

      const extensions = await pool.query(
        `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
      );
      expect(extensions.rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  }, 60000);
});

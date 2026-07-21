/**
 * Removes stored blobs (original + normalized artifact) for documents that
 * were soft-deleted more than N days ago (PLAN.md Phase 10 blob cleanup).
 *
 * DRY-RUN BY DEFAULT — nothing is deleted without the explicit --apply flag
 * (repo rule: no script silently deletes data).
 *
 *   pnpm tsx tools/scripts/cleanup-blobs.ts [--days 30] [--apply]
 */
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { loadDotenv, loadWorkerEnv } from '@doc-rag/config';
import {
  createDatabase,
  createPool,
  documents,
  documentVersions,
} from '@doc-rag/database';
import { AzureBlobObjectStorage } from '@doc-rag/storage';

async function main(): Promise<void> {
  loadDotenv();
  const env = loadWorkerEnv();
  const apply = process.argv.includes('--apply');
  const daysIndex = process.argv.indexOf('--days');
  const days = daysIndex > -1 ? Number(process.argv[daysIndex + 1]) : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const pool = createPool(env.DATABASE_URL);
  const db = createDatabase(pool);
  const originals = new AzureBlobObjectStorage({
    connectionString: env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
    containerName: env.AZURE_STORAGE_BLOB_CONTAINER_ORIGINALS,
  });
  const artifacts = new AzureBlobObjectStorage({
    connectionString: env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
    containerName: env.AZURE_STORAGE_BLOB_CONTAINER_ARTIFACTS,
  });

  try {
    const rows = await db
      .select({
        documentId: documents.id,
        fileName: documents.fileName,
        deletedAt: documents.deletedAt,
        storageKey: documentVersions.storageKey,
        artifactKey: documentVersions.normalizedArtifactKey,
      })
      .from(documents)
      .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
      .where(
        and(isNotNull(documents.deletedAt), lt(documents.deletedAt, cutoff)),
      );

    console.log(
      `[cleanup] ${rows.length} stored object set(s) for documents deleted before ${cutoff.toISOString()} (${apply ? 'APPLY' : 'dry-run'})`,
    );
    for (const row of rows) {
      console.log(
        `[cleanup] ${apply ? 'deleting' : 'would delete'} ${row.storageKey}${row.artifactKey ? ` + ${row.artifactKey}` : ''}`,
      );
      if (apply) {
        await originals.deleteObject(row.storageKey);
        if (row.artifactKey) await artifacts.deleteObject(row.artifactKey);
      }
    }
    if (!apply && rows.length > 0) {
      console.log('[cleanup] re-run with --apply to delete');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[cleanup] failed:', error);
  process.exit(1);
});

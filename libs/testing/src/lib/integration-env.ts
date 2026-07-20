/**
 * Reads the connection settings integration tests need. Returns null when they
 * are not present so suites can skip instead of failing on machines where the
 * local environment (docker compose up / CI Compose services) is not up.
 */
export interface IntegrationEnv {
  databaseUrl: string;
  blobConnectionString: string;
  queueConnectionString: string;
}

export function readIntegrationEnv(): IntegrationEnv | null {
  const databaseUrl = process.env['DATABASE_URL'];
  const blobConnectionString =
    process.env['AZURE_STORAGE_BLOB_CONNECTION_STRING'];
  const queueConnectionString =
    process.env['AZURE_STORAGE_QUEUE_CONNECTION_STRING'];
  if (!databaseUrl || !blobConnectionString || !queueConnectionString) {
    return null;
  }
  return { databaseUrl, blobConnectionString, queueConnectionString };
}

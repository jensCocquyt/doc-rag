import { loadApiEnv } from '@doc-rag/config';
import { HealthService } from './health.service';

// Requires a running local environment (docker compose up, or CI Compose
// services) providing DATABASE_URL and the Azurite connection strings.
const configured =
  !!process.env.DATABASE_URL &&
  !!process.env.AZURE_STORAGE_BLOB_CONNECTION_STRING &&
  !!process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING;

describe.skipIf(!configured)('HealthService (integration)', () => {
  it('reports all dependencies up against the live local environment', async () => {
    const service = new HealthService(loadApiEnv());
    const report = await service.check();
    expect(report).toEqual({
      status: 'ok',
      checks: { postgres: 'up', blobStorage: 'up', queueStorage: 'up' },
    });
  });

  it('reports postgres down for an unreachable database without throwing', async () => {
    const env = loadApiEnv();
    const service = new HealthService({
      ...env,
      DATABASE_URL: 'postgresql://nobody:wrong@127.0.0.1:59999/nope',
    });
    const report = await service.check();
    expect(report.status).toBe('degraded');
    expect(report.checks.postgres).toBe('down');
    expect(report.checks.blobStorage).toBe('up');
  });
});

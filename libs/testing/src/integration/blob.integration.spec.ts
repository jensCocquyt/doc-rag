import { BlobServiceClient } from '@azure/storage-blob';
import { readIntegrationEnv } from '../lib/integration-env';

const env = readIntegrationEnv();

describe.skipIf(!env)('Blob Storage round-trip (Azurite)', () => {
  const containerName = `it-blob-${Date.now()}`;

  it('creates a container, uploads and reads back a blob, then cleans up', async () => {
    const service = BlobServiceClient.fromConnectionString(
      env!.blobConnectionString,
    );
    const container = service.getContainerClient(containerName);
    await container.create();
    try {
      const content = 'phase-0 integration fixture';
      const blob = container.getBlockBlobClient('fixture.txt');
      await blob.upload(content, Buffer.byteLength(content));

      const download = await blob.downloadToBuffer();
      expect(download.toString()).toBe(content);
    } finally {
      await container.delete();
    }
  });
});

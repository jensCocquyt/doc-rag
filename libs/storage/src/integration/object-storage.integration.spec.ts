import { BlobServiceClient } from '@azure/storage-blob';
import { AzureBlobObjectStorage } from '../lib/azure-blob-object-storage';

// Requires the local infrastructure (pnpm infra:up) or the CI Compose services.
const connectionString = process.env['AZURE_STORAGE_BLOB_CONNECTION_STRING'];

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream) {
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  }
  return Buffer.concat(parts);
}

describe.skipIf(!connectionString)('AzureBlobObjectStorage (Azurite)', () => {
  const containerName = `it-storage-${Date.now()}`;
  let storage: AzureBlobObjectStorage;

  beforeAll(() => {
    storage = new AzureBlobObjectStorage({
      connectionString: connectionString!,
      containerName,
    });
  });

  afterAll(async () => {
    await BlobServiceClient.fromConnectionString(connectionString!)
      .getContainerClient(containerName)
      .deleteIfExists();
  });

  it('round-trips an object: upload target → verify → read → preview → delete', async () => {
    const key = 'tenants/t1/documents/d1/versions/1/original.pdf';
    const content = Buffer.from('phase-2 storage fixture');

    const target = await storage.createUploadTarget(
      key,
      'application/pdf',
      300,
    );
    const put = await fetch(target.url, {
      method: 'PUT',
      headers: target.headers,
      body: content,
    });
    expect(put.status).toBe(201);

    const verified = await storage.verifyObject(key);
    expect(verified).toEqual({
      exists: true,
      sizeBytes: content.length,
      contentType: 'application/pdf',
    });

    const read = await streamToBuffer(await storage.readObjectStream(key));
    expect(read.equals(content)).toBe(true);

    const preview = await storage.createPreviewTarget(key, 60);
    const previewResponse = await fetch(preview.url);
    expect(previewResponse.status).toBe(200);
    expect(Buffer.from(await previewResponse.arrayBuffer()).equals(content)).toBe(
      true,
    );

    await storage.deleteObject(key);
    expect(await storage.verifyObject(key)).toEqual({ exists: false });
  });

  it('writes and reads back a server-side artifact object', async () => {
    const key = 'artifacts/normalized.json';
    const payload = JSON.stringify({ elements: [] });
    await storage.writeObject(key, payload, 'application/json');
    const verified = await storage.verifyObject(key);
    expect(verified).toEqual({
      exists: true,
      sizeBytes: payload.length,
      contentType: 'application/json',
    });
    const read = await streamToBuffer(await storage.readObjectStream(key));
    expect(read.toString('utf8')).toBe(payload);
    await storage.deleteObject(key);
  });

  it('rejects writing a different blob name with the same SAS', async () => {
    const target = await storage.createUploadTarget(
      'allowed/blob.pdf',
      'application/pdf',
      300,
    );
    const hijacked = new URL(target.url);
    hijacked.pathname = hijacked.pathname.replace(
      'allowed/blob.pdf',
      'allowed/other.pdf',
    );
    const put = await fetch(hijacked.toString(), {
      method: 'PUT',
      headers: target.headers,
      body: 'not allowed',
    });
    expect(put.status).toBe(403);
    expect(await storage.verifyObject('allowed/other.pdf')).toEqual({
      exists: false,
    });
  });

  it('rejects an expired upload URL', async () => {
    const target = await storage.createUploadTarget(
      'expired/blob.pdf',
      'application/pdf',
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const put = await fetch(target.url, {
      method: 'PUT',
      headers: target.headers,
      body: 'too late',
    });
    expect(put.status).toBe(403);
    expect(await storage.verifyObject('expired/blob.pdf')).toEqual({
      exists: false,
    });
  });

  it('accepts a 100 MB direct upload (large upload smoke test)', async () => {
    const key = 'large/hundred-megabytes.pdf';
    const size = 100 * 1024 * 1024;
    const target = await storage.createUploadTarget(
      key,
      'application/pdf',
      300,
    );
    const put = await fetch(target.url, {
      method: 'PUT',
      headers: target.headers,
      body: Buffer.alloc(size, 7),
    });
    expect(put.status).toBe(201);
    const verified = await storage.verifyObject(key);
    expect(verified.exists && verified.sizeBytes).toBe(size);
    await storage.deleteObject(key);
  });
});

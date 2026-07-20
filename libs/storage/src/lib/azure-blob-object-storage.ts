import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import type {
  ObjectStorage,
  PreviewTarget,
  UploadTarget,
  VerifiedObject,
} from './object-storage';

export interface AzureBlobObjectStorageOptions {
  connectionString: string;
  containerName: string;
}

function parseSharedKeyCredential(
  connectionString: string,
): StorageSharedKeyCredential {
  const parts = new Map(
    connectionString
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return [part.slice(0, separator), part.slice(separator + 1)] as const;
      }),
  );
  const accountName = parts.get('AccountName');
  const accountKey = parts.get('AccountKey');
  if (!accountName || !accountKey) {
    throw new Error(
      'Blob connection string must contain AccountName and AccountKey to sign SAS URLs',
    );
  }
  return new StorageSharedKeyCredential(accountName, accountKey);
}

/**
 * Blob-backed ObjectStorage that works against Azurite locally and Azure Blob
 * Storage in Azure. SAS URLs are signed with the account's shared key parsed
 * from the connection string; a managed-identity variant (user-delegation SAS)
 * can replace the credential source in the deployment phase without changing
 * callers.
 */
export class AzureBlobObjectStorage implements ObjectStorage {
  private readonly service: BlobServiceClient;
  private readonly credential: StorageSharedKeyCredential;
  private readonly containerName: string;
  private containerReady: Promise<void> | undefined;

  constructor(options: AzureBlobObjectStorageOptions) {
    this.service = BlobServiceClient.fromConnectionString(
      options.connectionString,
    );
    this.credential = parseSharedKeyCredential(options.connectionString);
    this.containerName = options.containerName;
  }

  private async ensureContainer(): Promise<void> {
    // Cached so the create round-trip happens once per process, but reset on
    // failure so a transient outage does not poison every later call.
    if (!this.containerReady) {
      this.containerReady = this.service
        .getContainerClient(this.containerName)
        .createIfNotExists()
        .then(() => undefined)
        .catch((error) => {
          this.containerReady = undefined;
          throw error;
        });
    }
    return this.containerReady;
  }

  private blobUrl(key: string): string {
    return this.service
      .getContainerClient(this.containerName)
      .getBlockBlobClient(key).url;
  }

  private signSas(
    key: string,
    permissions: string,
    ttlSeconds: number,
    contentType?: string,
  ): { query: string; expiresAt: Date } {
    const now = Date.now();
    const expiresAt = new Date(now + ttlSeconds * 1000);
    const query = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse(permissions),
        // Small backdate absorbs clock skew between signer and storage.
        startsOn: new Date(now - 5 * 60 * 1000),
        expiresOn: expiresAt,
        // HttpsAndHttp because Azurite serves plain http locally.
        protocol: SASProtocol.HttpsAndHttp,
        ...(contentType ? { contentType } : {}),
      },
      this.credential,
    ).toString();
    return { query, expiresAt };
  }

  async createUploadTarget(
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<UploadTarget> {
    await this.ensureContainer();
    // create+write only: the URL can put this one blob and nothing else.
    const { query, expiresAt } = this.signSas(key, 'cw', ttlSeconds);
    return {
      url: `${this.blobUrl(key)}?${query}`,
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': contentType,
      },
      expiresAt,
    };
  }

  async verifyObject(key: string): Promise<VerifiedObject> {
    const blob = this.service
      .getContainerClient(this.containerName)
      .getBlockBlobClient(key);
    try {
      const properties = await blob.getProperties();
      return {
        exists: true,
        sizeBytes: properties.contentLength ?? 0,
        contentType: properties.contentType,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { exists: false };
      }
      throw error;
    }
  }

  async readObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const blob = this.service
      .getContainerClient(this.containerName)
      .getBlockBlobClient(key);
    const response = await blob.download();
    if (!response.readableStreamBody) {
      throw new Error(`Blob '${key}' returned no readable stream`);
    }
    return response.readableStreamBody;
  }

  async writeObject(
    key: string,
    content: Buffer | string,
    contentType: string,
  ): Promise<void> {
    await this.ensureContainer();
    const data = typeof content === 'string' ? Buffer.from(content) : content;
    await this.service
      .getContainerClient(this.containerName)
      .getBlockBlobClient(key)
      .upload(data, data.length, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
  }

  async createPreviewTarget(
    key: string,
    ttlSeconds: number,
  ): Promise<PreviewTarget> {
    const { query, expiresAt } = this.signSas(key, 'r', ttlSeconds);
    return { url: `${this.blobUrl(key)}?${query}`, expiresAt };
  }

  async deleteObject(key: string): Promise<void> {
    await this.service
      .getContainerClient(this.containerName)
      .getBlockBlobClient(key)
      .deleteIfExists();
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

/**
 * Development-only: allows the browser (Vite dev server origin) to PUT
 * directly to Azurite. In Azure, storage-account CORS is configured in Bicep
 * during the deployment phase — never from application code.
 */
export async function configureDevelopmentCors(
  connectionString: string,
): Promise<void> {
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const properties = await service.getProperties();
  await service.setProperties({
    ...properties,
    cors: [
      {
        allowedOrigins: '*',
        allowedMethods: 'GET,HEAD,PUT,OPTIONS',
        allowedHeaders: '*',
        exposedHeaders: '*',
        maxAgeInSeconds: 3600,
      },
    ],
  });
}

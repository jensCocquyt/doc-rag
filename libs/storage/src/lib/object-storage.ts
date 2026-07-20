/**
 * Boundary between the application and object storage (Azurite locally,
 * Azure Blob Storage in Azure). File contents never pass through the API
 * process: the API only mints scoped URLs and inspects object metadata;
 * bytes travel browser → storage and storage → worker directly.
 */

/** A short-lived URL that can write exactly one predetermined object. */
export interface UploadTarget {
  url: string;
  /** Headers the client must send with the PUT (blob type, content type). */
  headers: Record<string, string>;
  expiresAt: Date;
}

/** A short-lived read-only URL for previewing one object. */
export interface PreviewTarget {
  url: string;
  expiresAt: Date;
}

export type VerifiedObject =
  | { exists: false }
  | { exists: true; sizeBytes: number; contentType: string | undefined };

export interface ObjectStorage {
  /**
   * Mints a URL that allows writing only the object at `key`, valid for
   * `ttlSeconds`. The key is always chosen by the server, never the client.
   */
  createUploadTarget(
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<UploadTarget>;

  /** Checks existence and size without downloading any content. */
  verifyObject(key: string): Promise<VerifiedObject>;

  /** Streams the object's content (used by the ingestion worker, never HTTP handlers). */
  readObjectStream(key: string): Promise<NodeJS.ReadableStream>;

  /** Mints a short-lived read-only URL for the object at `key`. */
  createPreviewTarget(key: string, ttlSeconds: number): Promise<PreviewTarget>;

  /** Removes the object; succeeds when it is already absent. */
  deleteObject(key: string): Promise<void>;
}

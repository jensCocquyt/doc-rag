import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ApiEnv } from '@doc-rag/config';
import type {
  DocumentDto,
  UploadSessionRequest,
  UploadSessionResponse,
} from '@doc-rag/contracts';
import type {
  AuditRepository,
  DocumentRecord,
  DocumentRepository,
  DocumentVersionRepository,
  IngestionJobRepository,
} from '@doc-rag/database';
import type { ObjectStorage } from '@doc-rag/storage';
import { API_ENV } from '../env.provider';
import { AUDIT_REPOSITORY } from '../core.module';
import type { RequestIdentity } from '../auth/auth.guard';
import {
  DOCUMENT_REPOSITORY,
  DOCUMENT_VERSION_REPOSITORY,
  INGESTION_JOB_REPOSITORY,
} from './database.provider';
import { IngestionQueueSender } from './ingestion-queue';
import { OBJECT_STORAGE } from './storage.provider';

function toDocumentDto(record: DocumentRecord): DocumentDto {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    status: record.status as DocumentDto['status'],
    createdAt: record.createdAt.toISOString(),
    modifiedAt: record.modifiedAt.toISOString(),
  };
}

/** All operations are scoped by the authenticated request identity. */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(DOCUMENT_VERSION_REPOSITORY)
    private readonly versions: DocumentVersionRepository,
    @Inject(INGESTION_JOB_REPOSITORY)
    private readonly jobs: IngestionJobRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly ingestionQueue: IngestionQueueSender,
  ) {}

  async createUploadSession(
    identity: RequestIdentity,
    request: UploadSessionRequest,
  ): Promise<UploadSessionResponse> {
    if (request.sizeBytes > this.env.MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'file_too_large',
        message: `File exceeds the maximum of ${this.env.MAX_FILE_SIZE_BYTES} bytes`,
      });
    }

    const document = await this.documents.create({
      tenantId: identity.tenantId,
      fileName: request.fileName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      createdByUserId: identity.userId,
    });
    // The storage key is derived server-side; clients never influence it.
    const storageKey = `tenants/${identity.tenantId}/documents/${document.id}/versions/1/original.pdf`;
    const version = await this.versions.create({
      documentId: document.id,
      versionNumber: 1,
      storageKey,
    });
    await this.documents.setActiveVersion(
      identity.tenantId,
      document.id,
      version.id,
    );

    const target = await this.storage.createUploadTarget(
      storageKey,
      request.mimeType,
      this.env.UPLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      tenantId: identity.tenantId,
      userId: identity.userId,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: document.id,
    });
    return {
      documentId: document.id,
      uploadUrl: target.url,
      uploadHeaders: target.headers,
      expiresAt: target.expiresAt.toISOString(),
    };
  }

  async completeUpload(
    identity: RequestIdentity,
    documentId: string,
  ): Promise<DocumentDto> {
    const document = await this.findDocumentOrThrow(identity, documentId);

    // Idempotency: once the upload is verified and queued, repeating the call
    // just reports the current state — no second job, no second message.
    if (['queued', 'processing', 'ready'].includes(document.status)) {
      return toDocumentDto(document);
    }
    if (document.status !== 'uploading' && document.status !== 'uploaded') {
      throw new ConflictException({
        code: 'invalid_document_state',
        message: `Cannot complete upload for a document in status '${document.status}'`,
      });
    }

    const version = await this.versions.findLatestByDocument(document.id);
    if (!version) {
      throw new InternalServerErrorException({
        code: 'missing_document_version',
        message: 'Document has no version record',
      });
    }

    const verified = await this.storage.verifyObject(version.storageKey);
    if (!verified.exists) {
      throw new BadRequestException({
        code: 'file_not_uploaded',
        message: 'No uploaded file was found for this document',
      });
    }
    if (verified.sizeBytes !== document.sizeBytes) {
      throw new BadRequestException({
        code: 'size_mismatch',
        message: `Uploaded size ${verified.sizeBytes} does not match declared size ${document.sizeBytes}`,
      });
    }

    await this.documents.setStatus(identity.tenantId, document.id, 'uploaded');
    const { job } = await this.jobs.createIfAbsent({
      documentVersionId: version.id,
      idempotencyKey: `ingest-${version.id}`,
    });
    // Queue message strictly after storage verification. A crash between
    // job insert and send leaves status 'uploaded', so the client can retry
    // complete-upload; a rare duplicate message is handled by the worker's
    // idempotent processing.
    await this.ingestionQueue.send({
      type: 'ingest-document-version',
      jobId: job.id,
      tenantId: identity.tenantId,
      documentId: document.id,
      documentVersionId: version.id,
    });
    await this.documents.setStatus(identity.tenantId, document.id, 'queued');

    return toDocumentDto({ ...document, status: 'queued' });
  }

  async createPreviewUrl(
    identity: RequestIdentity,
    documentId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const document = await this.findDocumentOrThrow(identity, documentId);
    const version = await this.versions.findLatestByDocument(document.id);
    if (!version) {
      throw new NotFoundException({
        code: 'missing_document_version',
        message: 'Document has no stored file',
      });
    }
    const target = await this.storage.createPreviewTarget(
      version.storageKey,
      this.env.PREVIEW_URL_TTL_SECONDS,
    );
    return { url: target.url, expiresAt: target.expiresAt.toISOString() };
  }

  /**
   * User-requested reprocessing of a failed (or message-lost queued)
   * document: requeues the existing job and re-sends the queue message after
   * re-verifying the stored object. Idempotent like complete-upload.
   */
  async retry(
    identity: RequestIdentity,
    documentId: string,
  ): Promise<DocumentDto> {
    const document = await this.findDocumentOrThrow(identity, documentId);
    if (!['failed', 'queued', 'uploaded'].includes(document.status)) {
      throw new ConflictException({
        code: 'invalid_document_state',
        message: `Cannot retry a document in status '${document.status}'`,
      });
    }
    const version = await this.versions.findLatestByDocument(document.id);
    if (!version) {
      throw new InternalServerErrorException({
        code: 'missing_document_version',
        message: 'Document has no version record',
      });
    }
    const verified = await this.storage.verifyObject(version.storageKey);
    if (!verified.exists) {
      throw new BadRequestException({
        code: 'file_not_uploaded',
        message: 'No stored file exists for this document',
      });
    }
    const { job } = await this.jobs.createIfAbsent({
      documentVersionId: version.id,
      idempotencyKey: `ingest-${version.id}`,
    });
    await this.jobs.requeue(job.id);
    await this.ingestionQueue.send({
      type: 'ingest-document-version',
      jobId: job.id,
      tenantId: identity.tenantId,
      documentId: document.id,
      documentVersionId: version.id,
    });
    await this.documents.setStatus(identity.tenantId, document.id, 'queued');
    return toDocumentDto({ ...document, status: 'queued' });
  }

  async list(identity: RequestIdentity): Promise<DocumentDto[]> {
    const records = await this.documents.list(identity.tenantId);
    return records.map(toDocumentDto);
  }

  async get(
    identity: RequestIdentity,
    documentId: string,
  ): Promise<DocumentDto> {
    return toDocumentDto(await this.findDocumentOrThrow(identity, documentId));
  }

  async softDelete(
    identity: RequestIdentity,
    documentId: string,
  ): Promise<void> {
    await this.findDocumentOrThrow(identity, documentId);
    // Soft delete only: the blob and rows remain until a later cleanup phase;
    // reads and retrieval exclude the document immediately.
    await this.documents.softDelete(identity.tenantId, documentId);
    await this.audit.record({
      tenantId: identity.tenantId,
      userId: identity.userId,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: documentId,
    });
  }

  private async findDocumentOrThrow(
    identity: RequestIdentity,
    documentId: string,
  ): Promise<DocumentRecord> {
    const document = await this.documents.findById(
      identity.tenantId,
      documentId,
    );
    if (!document) {
      throw new NotFoundException({
        code: 'document_not_found',
        message: 'Document not found',
      });
    }
    return document;
  }
}

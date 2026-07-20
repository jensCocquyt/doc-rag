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
import { POC_TENANT_ID, POC_USER_ID } from '@doc-rag/database';
import type {
  DocumentRecord,
  DocumentRepository,
  DocumentVersionRepository,
  IngestionJobRepository,
} from '@doc-rag/database';
import type { ObjectStorage } from '@doc-rag/storage';
import { API_ENV } from '../env.provider';
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

@Injectable()
export class DocumentsService {
  // Until Entra authentication (Phase 9) every request acts as the seeded
  // POC identity; all repository calls stay tenant-scoped regardless.
  private readonly tenantId = POC_TENANT_ID;
  private readonly userId = POC_USER_ID;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(DOCUMENT_VERSION_REPOSITORY)
    private readonly versions: DocumentVersionRepository,
    @Inject(INGESTION_JOB_REPOSITORY)
    private readonly jobs: IngestionJobRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly ingestionQueue: IngestionQueueSender,
  ) {}

  async createUploadSession(
    request: UploadSessionRequest,
  ): Promise<UploadSessionResponse> {
    if (request.sizeBytes > this.env.MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'file_too_large',
        message: `File exceeds the maximum of ${this.env.MAX_FILE_SIZE_BYTES} bytes`,
      });
    }

    const document = await this.documents.create({
      tenantId: this.tenantId,
      fileName: request.fileName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      createdByUserId: this.userId,
    });
    // The storage key is derived server-side; clients never influence it.
    const storageKey = `tenants/${this.tenantId}/documents/${document.id}/versions/1/original.pdf`;
    const version = await this.versions.create({
      documentId: document.id,
      versionNumber: 1,
      storageKey,
    });
    await this.documents.setActiveVersion(
      this.tenantId,
      document.id,
      version.id,
    );

    const target = await this.storage.createUploadTarget(
      storageKey,
      request.mimeType,
      this.env.UPLOAD_URL_TTL_SECONDS,
    );
    return {
      documentId: document.id,
      uploadUrl: target.url,
      uploadHeaders: target.headers,
      expiresAt: target.expiresAt.toISOString(),
    };
  }

  async completeUpload(documentId: string): Promise<DocumentDto> {
    const document = await this.findDocumentOrThrow(documentId);

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

    await this.documents.setStatus(this.tenantId, document.id, 'uploaded');
    const { job } = await this.jobs.createIfAbsent({
      documentVersionId: version.id,
      idempotencyKey: `ingest-${version.id}`,
    });
    // Queue message strictly after storage verification. A crash between
    // job insert and send leaves status 'uploaded', so the client can retry
    // complete-upload; a rare duplicate message is handled by the worker's
    // idempotent processing (Phase 3).
    await this.ingestionQueue.send({
      type: 'ingest-document-version',
      jobId: job.id,
      tenantId: this.tenantId,
      documentId: document.id,
      documentVersionId: version.id,
    });
    await this.documents.setStatus(this.tenantId, document.id, 'queued');

    return toDocumentDto({ ...document, status: 'queued' });
  }

  async list(): Promise<DocumentDto[]> {
    const records = await this.documents.list(this.tenantId);
    return records.map(toDocumentDto);
  }

  async get(documentId: string): Promise<DocumentDto> {
    return toDocumentDto(await this.findDocumentOrThrow(documentId));
  }

  async softDelete(documentId: string): Promise<void> {
    await this.findDocumentOrThrow(documentId);
    // Soft delete only: the blob and rows remain until a later cleanup phase;
    // reads and (later) retrieval exclude the document immediately.
    await this.documents.softDelete(this.tenantId, documentId);
  }

  private async findDocumentOrThrow(documentId: string): Promise<DocumentRecord> {
    const document = await this.documents.findById(this.tenantId, documentId);
    if (!document) {
      throw new NotFoundException({
        code: 'document_not_found',
        message: 'Document not found',
      });
    }
    return document;
  }
}

import { Module } from '@nestjs/common';
import { apiEnvProvider, API_ENV } from '../env.provider';
import {
  DatabaseClient,
  DOCUMENT_REPOSITORY,
  DOCUMENT_VERSION_REPOSITORY,
  INGESTION_JOB_REPOSITORY,
  repositoryProviders,
} from './database.provider';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestionQueueSender } from './ingestion-queue';
import { objectStorageProvider, OBJECT_STORAGE } from './storage.provider';

@Module({
  controllers: [DocumentsController],
  providers: [
    apiEnvProvider,
    DatabaseClient,
    ...repositoryProviders,
    objectStorageProvider,
    IngestionQueueSender,
    DocumentsService,
  ],
  exports: [
    API_ENV,
    DatabaseClient,
    DOCUMENT_REPOSITORY,
    DOCUMENT_VERSION_REPOSITORY,
    INGESTION_JOB_REPOSITORY,
    OBJECT_STORAGE,
  ],
})
export class DocumentsModule {}

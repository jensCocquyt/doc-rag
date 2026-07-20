import { Module } from '@nestjs/common';
import { apiEnvProvider } from '../env.provider';
import {
  DatabaseClient,
  repositoryProviders,
} from './database.provider';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestionQueueSender } from './ingestion-queue';
import { objectStorageProvider } from './storage.provider';

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
})
export class DocumentsModule {}

import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestionQueueSender } from './ingestion-queue';

// Env, database, repositories and storage come from the global CoreModule.
@Module({
  controllers: [DocumentsController],
  providers: [IngestionQueueSender, DocumentsService],
})
export class DocumentsModule {}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConversationsModule } from './conversations/conversations.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule, DocumentsModule, ConversationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

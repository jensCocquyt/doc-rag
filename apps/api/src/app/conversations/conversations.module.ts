import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { aiProviders } from './ai.provider';
import { ChatService } from './chat.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [DocumentsModule],
  controllers: [ConversationsController],
  providers: [...aiProviders, ConversationsService, ChatService],
})
export class ConversationsModule {}

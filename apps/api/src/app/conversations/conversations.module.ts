import { Module } from '@nestjs/common';
import { aiProviders } from './ai.provider';
import { ChatService } from './chat.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// Env, database, repositories and storage come from the global CoreModule.
@Module({
  controllers: [ConversationsController],
  providers: [...aiProviders, ConversationsService, ChatService],
})
export class ConversationsModule {}

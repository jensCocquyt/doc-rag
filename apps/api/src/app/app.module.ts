import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CoreModule } from './core.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    HealthModule,
    DocumentsModule,
    ConversationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

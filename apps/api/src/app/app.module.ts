import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule, DocumentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

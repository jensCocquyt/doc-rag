import { Module } from '@nestjs/common';
import { apiEnvProvider } from '../env.provider';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, apiEnvProvider],
})
export class HealthModule {}

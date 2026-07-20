import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { HealthReport } from '@doc-rag/contracts';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<HealthReport> {
    const report = await this.healthService.check();
    reply.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}

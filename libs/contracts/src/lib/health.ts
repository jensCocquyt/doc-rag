import { z } from 'zod';

export const healthCheckStateSchema = z.enum(['up', 'down']);

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    postgres: healthCheckStateSchema,
    blobStorage: healthCheckStateSchema,
    queueStorage: healthCheckStateSchema,
  }),
});

export type HealthCheckState = z.infer<typeof healthCheckStateSchema>;
export type HealthReport = z.infer<typeof healthReportSchema>;

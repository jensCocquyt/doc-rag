import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Parses a request body at the HTTP boundary; Zod issues become a 400. */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      code: 'validation_failed',
      message: z.prettifyError(result.error),
    });
  }
  return result.data;
}

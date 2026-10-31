import { BadRequestException } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

/** Parses a request body or query against a schema; responds 400 with field errors on failure. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

/**
 * Cursor pagination that keeps list bodies as plain arrays (so existing clients keep working):
 * pass `take` and `cursor`; when more rows exist the response carries `X-Next-Cursor`, the id of
 * the last row, to pass as `cursor` for the next page. Ordering is newest first with id as tiebreak.
 */
import type { Response } from 'express';
import { z } from 'zod';
import { parse } from './zod';

export function pageArgs(q: unknown, max = 200, def = 50) {
  const x = parse(z.object({ take: z.coerce.number().int().min(1).max(max).default(def), cursor: z.string().max(60).optional() }).passthrough(), q ?? {});
  return { take: x.take + 1, ...(x.cursor ? { cursor: { id: x.cursor }, skip: 1 } : {}), want: x.take };
}

export function paged<T extends { id: string }>(rows: T[], want: number, res?: Response) {
  if (rows.length <= want) return rows;
  const page = rows.slice(0, want);
  res?.setHeader('X-Next-Cursor', page[page.length - 1].id);
  return page;
}

export type Page = ReturnType<typeof pageArgs>;
/** What a service uses when called without paging arguments (internal callers): up to 500 rows. */
export const DEFAULT_PAGE: Page = { take: 501, want: 500 };

/** Paging for lists filtered in memory after the query (same contract as `paged`). */
export function pageInMemory<T extends { id: string }>(rows: T[], q: unknown, res?: Response, max = 500, def = 500) {
  const { want, cursor } = pageArgs(q, max, def);
  const start = cursor ? rows.findIndex((r) => r.id === cursor.id) + 1 : 0;
  return paged(rows.slice(start, start + want + 1), want, res);
}

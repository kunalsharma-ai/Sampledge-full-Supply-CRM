/** Shared identifiers (docs/ECOSYSTEM_ARCHITECTURE.md §2). */
import { randomBytes, randomUUID } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26-character ULID: 48-bit millisecond time + 80 random bits, Crockford base32. Sortable by time. */
export function ulid(nowMs = Date.now()): string {
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[rnd[i]! % 32];
  return time + rand;
}

export const AUDIENCE_REQUEST_ID = /^AR-[0-9A-HJKMNP-TV-Z]{26}$/;
export const newAudienceRequestId = (nowMs?: number) => `AR-${ulid(nowMs)}`;
export const isAudienceRequestId = (v: unknown): v is string => typeof v === 'string' && AUDIENCE_REQUEST_ID.test(v);

export const newEventId = () => randomUUID();
export const prefixedId = (prefix: string) => `${prefix}_${ulid().toLowerCase()}`;
/** Opaque bearer-style token (sessions, invitations): 32 random bytes, base64url. */
export const opaqueToken = () => randomBytes(32).toString('base64url');

export const SOURCE_PLATFORMS = ['PROJEXA', 'ZAPX', 'EXTERNAL'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const SYSTEMS = ['SUPPLY360', 'SAMPLEON', 'PROJEXA', 'ZAPX', 'EXTERNAL'] as const;
export type SystemName = (typeof SYSTEMS)[number];

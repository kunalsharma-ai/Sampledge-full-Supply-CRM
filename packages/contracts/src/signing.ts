/**
 * Service authentication (§5.0) and the survey-host outcome signature (§5.3).
 *
 *   X-Sampledge-Client:    client id
 *   X-Sampledge-Timestamp: unix seconds
 *   X-Sampledge-Signature: v1=hex HMAC-SHA256(secret, ts + "." + METHOD + "." + path + "." + sha256hex(body))
 *
 * `path` is the request path including the query string, exactly as sent.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_WINDOW_SECONDS = 300;
export const HEADER_CLIENT = 'x-sampledge-client';
export const HEADER_TIMESTAMP = 'x-sampledge-timestamp';
export const HEADER_SIGNATURE = 'x-sampledge-signature';
export const HEADER_IDEMPOTENCY = 'idempotency-key';

export const unixSeconds = (nowMs = Date.now()) => Math.floor(nowMs / 1000);
export const sha256Hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');

export function safeEqualHex(expected: string, given: string | undefined | null): boolean {
  if (!given || !/^[0-9a-f]+$/i.test(given) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}

export function canonical(timestamp: string | number, method: string, path: string, body: string | Buffer | null | undefined) {
  return `${timestamp}.${method.toUpperCase()}.${path}.${sha256Hex(body ?? '')}`;
}

export function signRequest(opts: { clientId: string; secret: string; method: string; path: string; body?: string | null; nowMs?: number }): Record<string, string> {
  const ts = String(unixSeconds(opts.nowMs));
  return {
    'X-Sampledge-Client': opts.clientId,
    'X-Sampledge-Timestamp': ts,
    'X-Sampledge-Signature': `v1=${hmacHex(opts.secret, canonical(ts, opts.method, opts.path, opts.body ?? ''))}`,
  };
}

export type VerifyResult = { ok: true; clientId: string } | { ok: false; reason: string };

/**
 * Verify a signed request. `secretsFor` returns every active secret of the client (rotation keeps
 * two), or an empty list for an unknown client.
 */
export function verifyRequest(opts: {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  body: string | Buffer | null | undefined;
  secretsFor: (clientId: string) => string[];
  nowMs?: number;
}): VerifyResult {
  const h = (k: string) => {
    const v = opts.headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const clientId = h(HEADER_CLIENT);
  const ts = h(HEADER_TIMESTAMP);
  const sig = h(HEADER_SIGNATURE);
  if (!clientId || !ts || !sig) return { ok: false, reason: 'Missing signature headers' };
  const n = Number(ts);
  if (!Number.isInteger(n) || Math.abs(unixSeconds(opts.nowMs) - n) > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: 'Timestamp outside the allowed window' };
  const given = sig.startsWith('v1=') ? sig.slice(3) : '';
  const msg = canonical(ts, opts.method, opts.path, opts.body);
  const secrets = opts.secretsFor(clientId);
  if (!secrets.length) return { ok: false, reason: 'Unknown client' };
  if (!secrets.some((s) => safeEqualHex(hmacHex(s, msg), given))) return { ok: false, reason: 'Bad signature' };
  return { ok: true, clientId };
}

/** Survey host → SAMPLEON outcome confirmation: hex HMAC(hostSecret, token.status.timestamp). */
export const outcomeSignature = (hostSecret: string, token: string, status: string, timestamp: number) => hmacHex(hostSecret, `${token}.${status}.${timestamp}`);

/**
 * Service-to-service authentication for SAMPLEON and the panel websites (Sampledge ecosystem
 * contract §5.0). Requests are signed with HMAC over the raw body; there is no user session.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { verifyRequest } from '@sampledge/contracts';

export type S2sKind = 'sampleon' | 'panel';
export interface S2sClient { id: string; kind: S2sKind; secrets: string[] }

/** Settings: SAMPLEON_CLIENT_ID (default sampleon) + SAMPLEON_SECRET; PANEL_CARDS_SECRET_T2O/_MFR/_MHO for the panel websites. */
export function s2sClients(env: NodeJS.ProcessEnv = process.env): S2sClient[] {
  const out: S2sClient[] = [];
  const secrets = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sampleon = secrets(env.SAMPLEON_SECRET);
  if (sampleon.length) out.push({ id: env.SAMPLEON_CLIENT_ID ?? 'sampleon', kind: 'sampleon', secrets: sampleon });
  for (const p of ['t2o', 'mfr', 'mho']) {
    const s = secrets(env[`PANEL_CARDS_SECRET_${p.toUpperCase()}`]);
    if (s.length) out.push({ id: p, kind: 'panel', secrets: s });
  }
  return out;
}

export const sampleonConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  url: env.SAMPLEON_URL?.replace(/\/+$/, '') || null,
  secret: secrets0(env.SAMPLEON_SECRET),
  /** The id SUPPLY360 signs with when it calls SAMPLEON. */
  clientIdAtSampleon: env.SUPPLY360_CLIENT_ID ?? 'supply360',
  tenant: env.SAMPLEON_TENANT ?? env.PANEL_BACKEND_TENANT ?? 'sampledge-demo',
});
function secrets0(v?: string) { return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0] ?? null; }

export function authenticateS2s(req: Request & { rawBody?: Buffer }, allowed: S2sKind[]): S2sClient {
  const clients = s2sClients().filter((c) => allowed.includes(c.kind));
  const r = verifyRequest({
    headers: req.headers,
    method: req.method,
    path: req.originalUrl,
    body: req.rawBody ?? '',
    secretsFor: (id) => clients.find((c) => c.id === id)?.secrets ?? [],
  });
  if (!r.ok) throw new UnauthorizedException(r.reason);
  return clients.find((c) => c.id === r.clientId)!;
}

/** SUPPLY360 → SAMPLEON events (e.g. reward.eligibility_confirmed), signed per contract §5.0. */
import { signRequest } from '@sampledge/contracts';
import { sampleonConfig } from './s2s';

export class SampleonNotConnected extends Error {}

export async function sendToSampleon(envelope: Record<string, unknown>) {
  const c = sampleonConfig();
  if (!c.url || !c.secret) throw new SampleonNotConnected('SAMPLEON is not connected (SAMPLEON_URL and SAMPLEON_SECRET)');
  const u = new URL(`${c.url}/api/v1/events`);
  const body = JSON.stringify(envelope);
  const res = await fetch(u, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': String(envelope.eventId), ...signRequest({ clientId: c.clientIdAtSampleon, secret: c.secret, method: 'POST', path: u.pathname, body }) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SAMPLEON refused the event: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

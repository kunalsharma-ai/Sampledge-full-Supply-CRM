import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AudienceRequestInput, evaluate, isAudienceRequestId, makeEvent, newAudienceRequestId, outcomeSignature,
  parseEvent, parseOutcome, signRequest, verifyRequest, withoutRespondent, checkAgainstCatalogue,
} from './index';

test('audience request ids are AR- + ULID and sort by time', () => {
  const a = newAudienceRequestId(1_700_000_000_000);
  const b = newAudienceRequestId(1_700_000_000_001);
  assert.ok(isAudienceRequestId(a) && isAudienceRequestId(b));
  assert.ok(a.slice(0, 13) <= b.slice(0, 13));
  assert.equal(isAudienceRequestId('AR-123'), false);
});

const base = {
  source: { platform: 'PROJEXA', projectId: 'PRJ-1045', surveyId: 'sv_1' },
  organization: { id: 'org_1', name: 'Acme Pharma' },
  countries: ['US', 'GB'],
  targeting: { criteria: [{ attribute: 'hcp.specialty', op: 'in', values: ['cardiology'] }] },
  requiredCompletes: 100,
  expectedIncidence: 0.5,
  loiMinutes: 15,
  reward: { points: 500 },
  fieldwork: { start: '2026-11-10', end: '2026-11-30' },
  survey: { launchUrl: 'https://take.zapx.example/s/abc?rid={token}', language: 'en' },
};

test('audience request validates countries, dates and quotas', () => {
  const ok = AudienceRequestInput.parse(base);
  assert.equal(ok.redirects.allowRouting, true);
  assert.equal(AudienceRequestInput.safeParse({ ...base, countries: ['usa'] }).success, false);
  assert.equal(AudienceRequestInput.safeParse({ ...base, fieldwork: { start: '2026-12-01', end: '2026-11-01' } }).success, false);
  assert.equal(AudienceRequestInput.safeParse({ ...base, quotas: [{ id: 'q1', country: 'DE', target: 5 }] }).success, false);
  assert.equal(AudienceRequestInput.safeParse({ ...base, completesByCountry: { FR: 10 } }).success, false);
});

test('criteria separate missing profile data from failures', () => {
  const criteria = [
    { attribute: 'hcp.specialty', op: 'in' as const, values: ['cardiology'] },
    { attribute: 'b2b.years_experience', op: 'gte' as const, value: 5 },
  ];
  assert.deepEqual(evaluate({ 'hcp.specialty': 'Cardiology', 'b2b.years_experience': 7 }, criteria), { eligible: true, missing: [], failed: [] });
  assert.deepEqual(evaluate({ 'hcp.specialty': 'cardiology' }, criteria), { eligible: false, missing: ['b2b.years_experience'], failed: [] });
  assert.deepEqual(evaluate({ 'hcp.specialty': 'oncology', 'b2b.years_experience': 2 }, criteria).failed, ['hcp.specialty', 'b2b.years_experience']);
  assert.deepEqual(checkAgainstCatalogue([{ attribute: 'x.y', op: 'exists' }], []), ['Unknown attribute x.y']);
});

test('signed requests verify, and tampering, replays and unknown clients fail', () => {
  const now = 1_793_000_000_000;
  const body = JSON.stringify({ a: 1 });
  const headers = Object.fromEntries(Object.entries(signRequest({ clientId: 'projexa', secret: 's1', method: 'POST', path: '/api/v1/audience-requests', body, nowMs: now })).map(([k, v]) => [k.toLowerCase(), v]));
  const secretsFor = (c: string) => (c === 'projexa' ? ['old', 's1'] : []);
  assert.deepEqual(verifyRequest({ headers, method: 'POST', path: '/api/v1/audience-requests', body, secretsFor, nowMs: now }), { ok: true, clientId: 'projexa' });
  assert.equal(verifyRequest({ headers, method: 'POST', path: '/api/v1/audience-requests', body: '{"a":2}', secretsFor, nowMs: now }).ok, false);
  assert.equal(verifyRequest({ headers, method: 'POST', path: '/api/v1/audience-requests', body, secretsFor, nowMs: now + 301_000 }).ok, false);
  assert.equal(verifyRequest({ headers: { ...headers, 'x-sampledge-client': 'zapx' }, method: 'POST', path: '/api/v1/audience-requests', body, secretsFor, nowMs: now }).ok, false);
});

test('outcome slugs and aliases', () => {
  assert.equal(parseOutcome('screenout'), 'terminate');
  assert.equal(parseOutcome('OVERQUOTA'), 'quota_full');
  assert.equal(parseOutcome('nope'), null);
  assert.equal(outcomeSignature('k', 't', 'complete', 1).length, 64);
});

test('events validate payloads, ignore unknown types and strip respondent fields', () => {
  const e = makeEvent({ type: 'survey.started', source: 'SAMPLEON', correlationId: 'AR-X', payload: { sessionId: 's', country: 'US', respondentRef: 'rsp_1', panel: 't2o' } });
  const parsed = parseEvent(JSON.parse(JSON.stringify(e)));
  assert.ok(parsed.ok && parsed.known);
  assert.equal(parseEvent({ ...e, type: 'something.new' }).ok, true);
  assert.equal(parseEvent({ ...e, payload: { country: 'US' } }).ok, false);
  const stripped = withoutRespondent(e);
  assert.equal('respondentRef' in stripped.payload, false);
  assert.throws(() => makeEvent({ type: 'quota.full', source: 'SAMPLEON', correlationId: 'AR-X', payload: { quotaId: 'q' } as never }));
});

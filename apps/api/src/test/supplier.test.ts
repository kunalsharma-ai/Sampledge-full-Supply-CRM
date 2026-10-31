/**
 * Supplier entry and exit: a vendor sets its exit links, respondents arrive through the allocation's
 * entry link with the supplier's id, and leave with the right link for their outcome. Duplicate
 * devices are flagged (not blocked).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, h, setup, teardown, type Res } from './harness';

before(setup);
after(teardown);

const COMPLETE: Record<string, unknown> = { S1: 'ft', S2: 'lg', S3: 'final', S4: ['tech'], Q1: ['aws'], Q2: 'aws', Q3: 50, Q4: { posture: '3', identity: '3', workload: '3', data: '3' }, Q5: ['price', 'int', 'sup', 'comp'], Q6: 'flat', Q9: 8, Q10: 'ok', Q11: 4, END: '' };

async function walk(responseId: string, answers: Record<string, unknown> = COMPLETE) {
  let q: string | null = 'S1';
  let last: Res | null = null;
  while (q) {
    last = await call('POST', `/r/session/${responseId}/answer`, { questionId: q, value: answers[q] ?? COMPLETE[q] });
    assert.equal(last.status, 200, `${q}: ${JSON.stringify(last.body)}`);
    q = last.body.outcome ? null : last.body.question.id;
  }
  return last!;
}

/** Starts a session the way the browser does, keeping the device cookie between calls. */
async function start(body: Record<string, unknown>, cookie?: string) {
  const r = await fetch(`${h.url}/api/v1/r/sv-cloud/start`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const set = r.headers.getSetCookie().find((c) => c.startsWith('sx_dev='))?.split(';')[0];
  return { status: r.status, body: await r.json() as { responseId: string; message?: string }, cookie: set ?? cookie };
}

let allocId = '';
let otherProjectAlloc = '';
let vendorId = '';

describe('supplier redirects', () => {
  before(async () => {
    await h.db.survey.update({ where: { id: 'sv-cloud' }, data: { status: 'Published' } });
    const s = await h.db.survey.findUniqueOrThrow({ where: { id: 'sv-cloud' } });
    const vendorUser = await h.db.membership.findFirstOrThrow({ where: { role: 'vendor' } });
    vendorId = vendorUser.vendorId!;
    const a = await h.db.allocation.create({ data: { tenantId: s.tenantId, projectId: s.projectId!, vendorId, completes: 100, cpi: 4, status: 'live' } });
    allocId = a.id;
    const other = await h.db.allocation.findFirstOrThrow({ where: { projectId: { not: s.projectId! } } });
    otherProjectAlloc = other.id;
  });

  it('lets the vendor set https exit links on its own allocation only', async () => {
    const bad = await as('vendor').patch(`/allocations/${allocId}/redirects`, { completeUrl: 'http://vendor.example.test/c?id={rid}' });
    assert.equal(bad.status, 400, 'http refused');
    const js = await as('vendor').patch(`/allocations/${allocId}/redirects`, { completeUrl: 'javascript:alert(1)' });
    assert.equal(js.status, 400);
    const ok = await as('vendor').patch(`/allocations/${allocId}/redirects`, {
      completeUrl: 'https://vendor.example.test/complete?id={rid}', screenoutUrl: 'https://vendor.example.test/term?id={rid}', overquotaUrl: 'https://vendor.example.test/oq?id={rid}',
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const theirs = await h.db.allocation.findFirstOrThrow({ where: { vendorId: { not: vendorId } } });
    assert.equal((await as('vendor').patch(`/allocations/${theirs.id}/redirects`, { completeUrl: 'https://x.example.test' })).status, 403);
    assert.equal((await as('executive').patch(`/allocations/${allocId}/redirects`, { completeUrl: 'https://x.example.test' })).status, 403, 'read-only role');
    assert.ok(await h.db.auditLog.findFirst({ where: { action: 'allocation.redirects', entityId: allocId } }));
    const list = (await as('vendor').get('/allocations')).body as { id: string; completeUrl: string; project: { surveys: { id: string }[] } }[];
    const mine = list.find((x) => x.id === allocId)!;
    assert.equal(mine.completeUrl, 'https://vendor.example.test/complete?id={rid}');
    assert.deepEqual(mine.project.surveys.map((x) => x.id), ['sv-cloud'], 'entry link target listed');
  });

  it('sends a complete back to the supplier with its own id, URL-encoded', async () => {
    const s = await start({ allocation: allocId, respondent: 'abc 1&x=2' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const last = await walk(s.body.responseId);
    assert.equal(last.body.outcome, 'complete');
    assert.equal(last.body.redirect, 'https://vendor.example.test/complete?id=abc%201%26x%3D2');
    const r = await h.db.response.findUniqueOrThrow({ where: { id: s.body.responseId } });
    assert.equal(r.source, `vendor:${vendorId}`);
    assert.equal(r.supplierRid, 'abc 1&x=2');
    const again = await call('GET', `/r/session/${s.body.responseId}`);
    assert.equal(again.body.redirect, last.body.redirect, 'a reload still finds the exit link');
  });

  it('sends a screenout to the terminate link', async () => {
    const s = await start({ allocation: allocId, respondent: 'r-2' });
    const last = await walk(s.body.responseId, { S1: 'none' });
    assert.equal(last.body.outcome, 'screenout');
    assert.equal(last.body.redirect, 'https://vendor.example.test/term?id=r-2');
  });

  it('has no exit link for direct traffic and refuses allocations from other projects or not open', async () => {
    const direct = await start({ respondent: 'd-1' });
    assert.match(direct.body.responseId, /^rs_[\w-]{24}$/, 'the session id is the respondent credential: 144 random bits, not a guessable cuid');
    const last = await walk(direct.body.responseId, { S1: 'none' });
    assert.equal(last.body.redirect, null);
    assert.equal((await start({ allocation: otherProjectAlloc, respondent: 'x' })).status, 404);
    await h.db.allocation.update({ where: { id: allocId }, data: { status: 'closed' } });
    assert.equal((await start({ allocation: allocId, respondent: 'x' })).status, 403);
    await h.db.allocation.update({ where: { id: allocId }, data: { status: 'live' } });
  });

  it('flags a second complete from the same browser without blocking it', async () => {
    const first = await start({ allocation: allocId, respondent: 'dev-a' });
    assert.ok(first.cookie, 'device cookie set');
    await walk(first.body.responseId);
    const second = await start({ allocation: allocId, respondent: 'dev-b' }, first.cookie);
    const last = await walk(second.body.responseId);
    assert.equal(last.body.outcome, 'complete', 'not blocked');
    const r = await h.db.response.findUniqueOrThrow({ where: { id: second.body.responseId } });
    assert.ok(r.flags.includes('duplicate_device'), JSON.stringify(r.flags));
    assert.notEqual(r.deviceHash, first.cookie!.split('=')[1], 'only a keyed hash is stored');
    const fresh = await start({ allocation: allocId, respondent: 'dev-c' });
    await walk(fresh.body.responseId);
    assert.ok(!(await h.db.response.findUniqueOrThrow({ where: { id: fresh.body.responseId } })).flags.includes('duplicate_device'));
  });
});

/**
 * API integration tests against a real Postgres (database sampledge_test, migrated and seeded here).
 * Covers authentication, tenant isolation, role scoping, field redaction, the approval gate,
 * CRM Won → project, the respondent runtime and atomic quota counting.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';
import { as, call, DEMO_PASSWORD, demoEmail, h, login, setup, teardown, type Res } from './harness';

const COMPLETE: Record<string, unknown> = { S1: 'ft', S2: 'lg', S3: 'final', S4: ['tech'], Q1: ['aws'], Q2: 'aws', Q3: 50, Q4: { posture: '3', identity: '3', workload: '3', data: '3' }, Q5: ['price', 'int', 'sup', 'comp'], Q6: 'flat', Q9: 8, Q10: 'ok', Q11: 4, END: '' };
/** Answers until `stopBefore` is the current question (or the session ends). */
async function walk(responseId: string, first: string, stopBefore?: string) {
  let q: string | null = first;
  let last: Res | null = null;
  while (q && q !== stopBefore) {
    last = await call('POST', `/r/session/${responseId}/answer`, { questionId: q, value: COMPLETE[q] });
    assert.equal(last.status, 200, `${q}: ${JSON.stringify(last.body)}`);
    q = last.body.outcome ? null : last.body.question.id;
  }
  return { last, cursor: q };
}

before(setup);
after(teardown);
const tokens = new Proxy({} as Record<string, string>, { get: (_, k: string) => h.tokens[k] });
const db = new Proxy({} as typeof h.db, { get: (_, k) => (h.db as never)[k as never] });

describe('authentication', () => {
  it('serves health without a session', async () => {
    assert.equal((await call('GET', '/health')).body.status, 'ok');
  });
  it('rejects requests without a session', async () => {
    assert.equal((await call('GET', '/projects')).status, 401);
  });
  it('rejects a wrong password with the same message as an unknown email', async () => {
    const a = await call('POST', '/auth/login', { email: demoEmail('executive'), password: 'nope' });
    const b = await call('POST', '/auth/login', { email: 'nobody@demo.sampledge.test', password: 'nope' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.message, b.body.message);
  });
  it('sets an httpOnly cookie and keeps the token out of the body by default', async () => {
    const r = await fetch(`${h.url}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: demoEmail('executive'), password: DEMO_PASSWORD }) });
    const cookie = r.headers.get('set-cookie') ?? '';
    assert.match(cookie, /sampledge_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.equal(((await r.json()) as { token?: string }).token, undefined);
  });
  it('validates bodies with field-level errors', async () => {
    const r = await call('POST', '/auth/login', { email: 'not-an-email', password: '' });
    assert.equal(r.status, 400);
    assert.ok(r.body.issues.some((i: { path: string }) => i.path === 'email'));
  });
  it('revokes the session on logout', async () => {
    const t = await login(demoEmail('finance'));
    assert.equal((await call('GET', '/auth/me', undefined, t)).status, 200);
    assert.equal((await call('POST', '/auth/logout', {}, t)).status, 200);
    assert.equal((await call('GET', '/auth/me', undefined, t)).status, 401);
  });
  it('enrols TOTP MFA and then requires a code to sign in', async () => {
    const t = await login(demoEmail('data_processing'));
    const e = await call('POST', '/auth/mfa/enroll', {}, t);
    assert.ok(e.body.otpauthUrl.startsWith('otpauth://'));
    assert.equal((await call('POST', '/auth/mfa/activate', { code: '000000' }, t)).status, 400);
    assert.equal((await call('POST', '/auth/mfa/activate', { code: authenticator.generate(e.body.secret) }, t)).status, 200);
    const step1 = await call('POST', '/auth/login', { email: demoEmail('data_processing'), password: DEMO_PASSWORD });
    assert.equal(step1.body.mfaRequired, true);
    assert.equal(step1.body.token, undefined);
    assert.equal((await call('POST', '/auth/mfa/verify', { challenge: step1.body.challenge, code: '123456' })).status, 401);
    const step2 = await call('POST', '/auth/mfa/verify', { challenge: step1.body.challenge, code: authenticator.generate(e.body.secret), returnToken: true });
    assert.equal(step2.status, 200);
    assert.equal((await call('GET', '/auth/me', undefined, step2.body.token)).body.role, 'data_processing');
  });
});

describe('tenant isolation', () => {
  it('shows each tenant only its own records', async () => {
    const mine = await as('platform_admin').get('/projects');
    const theirs = await as('iso').get('/projects');
    assert.equal(mine.body.length, 24);
    assert.equal(theirs.body.length, 1);
    assert.ok(!mine.body.some((p: { name: string }) => p.name === 'Other tenant private project'));
    assert.equal((await as('iso').get('/vendors')).body.length, 1);
  });
  it('returns 404, not 403, for another tenant\'s ids (no existence leak)', async () => {
    assert.equal((await as('iso').get('/projects/pr-001')).status, 404);
    assert.equal((await as('iso').patch('/projects/pr-001/stage', { stage: 'QA' })).status, 404);
    assert.equal((await as('iso').get('/opportunities/op-001')).status, 404);
    assert.equal((await as('iso').get('/surveys/sv-cloud')).status, 404);
  });
});

describe('roles and redaction', () => {
  it('removes margin fields for roles without view:margins', async () => {
    const exec = (await as('executive').get('/projects/pr-001')).body;
    const prog = (await as('survey_programmer').get('/projects/pr-001')).body;
    assert.equal(typeof exec.cpiCost, 'number');
    assert.equal(typeof exec.budget, 'number');
    for (const f of ['cpiCost', 'margin', 'budget', 'costIncurred']) assert.equal(prog[f], undefined, f);
    assert.equal(typeof prog.cpiSell, 'number');
  });
  it('scopes a vendor user to their own vendor and allocations', async () => {
    const v = await as('vendor').get('/vendors');
    assert.deepEqual(v.body.map((x: { id: string }) => x.id), ['vd-01']);
    assert.equal(typeof v.body[0].cpiB2C, 'number', 'a vendor sees its own rate card');
    assert.equal((await as('vendor').get('/vendors/vd-02')).status, 404);
    const allocs = (await as('vendor').get('/allocations')).body;
    assert.ok(allocs.every((a: { vendorId: string }) => a.vendorId === 'vd-01'));
    assert.equal((await as('vendor').get('/projects')).status, 403);
    assert.equal((await as('vendor').get('/vendor-ranking?audience=B2C&country=US&n=100&ir=0.5&loi=10')).status, 403);
    assert.equal((await as('vendor').get('/dashboard/summary')).status, 403);
  });
  it('hides competitor rate cards from roles without view:vendor_bids', async () => {
    const r = (await as('panel_manager').get('/vendors')).body;
    assert.ok(r.length > 1);
    assert.ok(r.every((v: Record<string, unknown>) => v.cpiB2C === undefined && v.pendingPayment === undefined));
  });
  it('scopes a client user to their own projects without costs', async () => {
    const r = (await as('client').get('/projects')).body;
    assert.ok(r.length > 0);
    assert.ok(r.every((p: { clientId: string; cpiCost?: number }) => p.clientId === 'cl-01' && p.cpiCost === undefined));
    const other = (await as('platform_admin').get('/projects')).body.find((p: { clientId: string }) => p.clientId !== 'cl-01');
    assert.equal((await as('client').get(`/projects/${other.id}`)).status, 404);
    assert.equal((await as('client').get('/clients')).body.length, 1);
  });
  it('enforces read-only module access on writes', async () => {
    const r = await as('executive').patch('/opportunities/op-001/stage', { stage: 'Qualifying' });
    assert.equal(r.status, 403);
    assert.match(r.body.message, /read-only/);
    assert.equal((await as('survey_programmer').patch('/projects/pr-001/stage', { stage: 'QA' })).status, 403);
  });
  it('rejects an unknown lifecycle stage', async () => {
    assert.equal((await as('project_manager').patch('/projects/pr-001/stage', { stage: 'Teleported' })).status, 400);
  });
  it('audits project changes with before and after', async () => {
    assert.equal((await as('project_manager').patch('/projects/pr-005/stage', { stage: 'QA' })).status, 200);
    const log = (await as('platform_admin').get('/audit?entity=Project&entityId=pr-005')).body;
    assert.equal(log[0].action, 'project.stage');
    assert.equal(log[0].after.stage, 'QA');
    assert.equal(log[0].actor, 'Priya Nair (Demo)');
  });
});

describe('CRM and quotes', () => {
  it('needs a loss reason to mark Lost', async () => {
    assert.equal((await as('bizdev').patch('/opportunities/op-001/stage', { stage: 'Lost' })).status, 400);
  });
  it('drafts an estimate quote, gates sending behind an approval, and blocks self-approval', async () => {
    const d = await as('bizdev').post('/opportunities/op-003/quotes', { targetMargin: 0.4 });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.equal(d.body.quote.basis, 'rate_card_estimate');
    assert.match(d.body.basis, /Not a supplier confirmation/);
    const s = await as('bizdev').post(`/quotes/${d.body.quote.id}/submit`);
    assert.equal(s.body.quote.status, 'pending_approval');
    const ap = s.body.approval.id;
    assert.equal((await as('bizdev').post(`/approvals/${ap}/decision`, { decision: 'approved' })).status, 403, 'requester cannot approve');
    assert.equal((await as('panel_manager').post(`/approvals/${ap}/decision`, { decision: 'approved' })).status, 403, 'role lacks approve:quotes');
    const ok = await as('executive').post(`/approvals/${ap}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200);
    assert.match(ok.body.effect, /development adapter: recorded, not emailed/);
    const o = (await as('bizdev').get('/opportunities/op-003')).body;
    assert.equal(o.quotes[0].status, 'sent');
  });
  it('creates the project when an opportunity is Won, in one transaction', async () => {
    const before = (await as('platform_admin').get('/projects')).body.length;
    const r = await as('bizdev').patch('/opportunities/op-003/stage', { stage: 'Won' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.project.code, /^SE-26\d+$/);
    assert.equal(r.body.project.stage, 'Project Setup');
    assert.deepEqual(r.body.project.blockers, [], 'the approved quote priced it');
    assert.equal((await as('platform_admin').get('/projects')).body.length, before + 1);
    assert.equal((await as('bizdev').patch('/opportunities/op-003/stage', { stage: 'Negotiation' })).status, 400);
  });
});

describe('sample allocation', () => {
  it('proposes an allocation as pending until a human approves the purchase', async () => {
    const p = (await as('project_manager').get('/projects/pr-002')).body;
    const v = (await as('project_manager').get('/vendors')).body.find((x: { coverage: string[]; audiences: string[] }) => x.audiences.includes(p.audience) && x.coverage.some((c) => p.countries.includes(c)));
    const r = await as('project_manager').post('/projects/pr-002/allocations', { vendorId: v.id, completes: 50, cpi: 20 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.allocation.status, 'proposed');
    assert.equal(r.body.approval.kind, 'Purchasing sample');
    assert.equal((await as('project_manager').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' })).status, 403);
    const ok = await as('pm2').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200);
    assert.match(ok.body.effect, /nothing leaves the system/);
  });
});

describe('survey lifecycle and respondent runtime', () => {
  it('does not serve an unpublished survey to anonymous respondents', async () => {
    assert.equal((await call('POST', '/r/sv-cloud/start', {})).status, 403);
  });
  it('lets staff preview, validates answers, and never counts preview completes', async () => {
    const cellsBefore = await db.quotaCell.findMany({ where: { surveyId: 'sv-cloud' }, orderBy: { key: 'asc' } });
    const s = await call('POST', '/r/sv-cloud/start', { preview: true }, tokens.survey_programmer);
    assert.equal(s.status, 201);
    assert.equal(s.body.preview, true);
    assert.equal(s.body.question.id, 'S1');
    const bad = await call('POST', `/r/session/${s.body.responseId}/answer`, { questionId: 'S1', value: 'martian' });
    assert.equal(bad.status, 422);
    assert.equal((await call('POST', `/r/session/${s.body.responseId}/answer`, { questionId: 'S3', value: 'final' })).status, 422, 'out of order');
    const { last } = await walk(s.body.responseId, 'S1');
    assert.equal(last!.body.outcome, 'complete');
    const cellsAfter = await db.quotaCell.findMany({ where: { surveyId: 'sv-cloud' }, orderBy: { key: 'asc' } });
    assert.deepEqual(cellsAfter.map((c) => c.count), cellsBefore.map((c) => c.count));
  });
  it('pipes earlier answers into question text', async () => {
    const s = await call('POST', '/r/sv-cloud/start', { preview: true }, tokens.survey_programmer);
    const { cursor } = await walk(s.body.responseId, 'S1', 'Q2');
    assert.equal(cursor, 'Q2');
    const st = await call('GET', `/r/session/${s.body.responseId}`);
    assert.match(st.body.question.text, /Platform A/);
  });
  it('screens out by routing rule', async () => {
    const s = await call('POST', '/r/sv-cloud/start', { preview: true }, tokens.survey_programmer);
    const r = await call('POST', `/r/session/${s.body.responseId}/answer`, { questionId: 'S1', value: 'none' });
    assert.equal(r.body.outcome, 'screenout');
  });
  it('blocks publishing while QA has critical issues', async () => {
    const qa = await as('survey_programmer').post('/surveys/sv-cloud/qa', { simulations: 200 });
    assert.equal(qa.body.publishable, false);
    assert.ok(qa.body.issues.some((i: { severity: string; questionId?: string }) => i.severity === 'critical' && i.questionId === 'S3'));
    assert.equal((await as('survey_programmer').post('/surveys/sv-cloud/publish')).status, 400);
  });
  it('saves a fixed version without losing collected quota counts, then publishes through approval', async () => {
    const s = (await as('survey_programmer').get('/surveys/sv-cloud')).body;
    const countsBefore = s.definition.quotas.map((q: { count: number }) => q.count);
    const fixed = { ...s.definition, rules: s.definition.rules.filter((r: { id: string }) => r.id !== 'r6') };
    assert.equal((await as('survey_programmer').put('/surveys/sv-cloud/definition', { definition: fixed, label: 'stale', baseVersion: s.currentVersion - 1 })).status, 400, 'stale base version');
    const saved = await as('survey_programmer').put('/surveys/sv-cloud/definition', { definition: fixed, label: 'Remove dangling rule r6', baseVersion: s.currentVersion });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.version, s.currentVersion + 1);
    const reloaded = (await as('survey_programmer').get('/surveys/sv-cloud')).body;
    assert.deepEqual(reloaded.definition.quotas.map((q: { count: number }) => q.count), countsBefore);
    assert.equal((await as('survey_programmer').get('/surveys/sv-cloud/versions')).body.length, s.currentVersion + 1);

    const pub = await as('survey_programmer').post('/surveys/sv-cloud/publish');
    assert.equal(pub.status, 201, JSON.stringify(pub.body));
    assert.equal(pub.body.approval.kind, 'Publishing surveys');
    assert.equal((await call('POST', '/r/sv-cloud/start', {})).status, 403, 'still not live before the decision');
    const ok = await as('platform_admin').post(`/approvals/${pub.body.approval.id}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200);
    assert.equal((await as('survey_programmer').get('/surveys/sv-cloud')).body.status, 'Published');
  });
  it('counts a live complete into every matching quota cell and the project', async () => {
    const proj = (await as('platform_admin').get('/projects/pr-002')).body.completes;
    const before = Object.fromEntries((await db.quotaCell.findMany({ where: { surveyId: 'sv-cloud' } })).map((c) => [c.key, c.count]));
    const s = await call('POST', '/r/sv-cloud/start', { source: 'panel:turn2opinion' });
    assert.equal(s.status, 201);
    const { last } = await walk(s.body.responseId, 'S1');
    assert.equal(last!.body.outcome, 'complete');
    const after = Object.fromEntries((await db.quotaCell.findMany({ where: { surveyId: 'sv-cloud' } })).map((c) => [c.key, c.count]));
    assert.equal(after.qt3, before.qt3 + 1, 'Company 1000+');
    assert.equal(after.qt4, before.qt4 + 1, 'Final decision-makers');
    assert.equal(after.qt1, before.qt1);
    assert.equal((await as('platform_admin').get('/projects/pr-002')).body.completes, proj + 1);
  });
  it('lets exactly one of several racing respondents take the last slot', async () => {
    const cell = await db.quotaCell.findUniqueOrThrow({ where: { surveyId_key: { surveyId: 'sv-cloud', key: 'qt3' } } });
    await db.quotaCell.update({ where: { id: cell.id }, data: { target: cell.count + 1 } });
    const sessions = await Promise.all([1, 2, 3, 4].map(() => call('POST', '/r/sv-cloud/start', { source: 'vendor:vd-01' })));
    for (const s of sessions) await walk(s.body.responseId, 'S1', 'END');
    const results = await Promise.all(sessions.map((s) => call('POST', `/r/session/${s.body.responseId}/answer`, { questionId: 'END', value: '' })));
    const outcomes = results.map((r) => r.body.outcome).sort();
    assert.deepEqual(outcomes, ['complete', 'overquota', 'overquota', 'overquota']);
    const final = await db.quotaCell.findUniqueOrThrow({ where: { id: cell.id } });
    assert.equal(final.count, final.target, 'never overfills');
    const next = await call('POST', '/r/sv-cloud/start', {});
    for (const q of ['S1']) await call('POST', `/r/session/${next.body.responseId}/answer`, { questionId: q, value: COMPLETE[q] });
    const early = await call('POST', `/r/session/${next.body.responseId}/answer`, { questionId: 'S2', value: 'lg' });
    assert.equal(early.body.outcome, 'overquota', 'a full cell terminates as soon as it is determined');
  });
  it('reports responses by outcome and source', async () => {
    const r = (await as('survey_programmer').get('/surveys/sv-cloud/responses')).body;
    const n = (o: string, src?: string) => r.summary.filter((x: { outcome: string; source: string }) => x.outcome === o && (!src || x.source === src)).reduce((s: number, x: { n: number }) => s + x.n, 0);
    assert.ok(n('complete', 'preview') >= 1);
    assert.equal(n('complete', 'vendor:vd-01'), 1);
    assert.ok(n('overquota') >= 4);
  });
});

describe('panels', () => {
  it('summarises synthetic panelists per brand', async () => {
    const r = (await as('panel_manager').get('/panels/summary')).body;
    assert.deepEqual(r.map((b: { id: string }) => b.id), ['turn2opinion', 'myfrequentrewards', 'myhealthopinions']);
    assert.equal(r.reduce((s: number, b: { records: number }) => s + b.records, 0), 200);
    assert.match(r[0].note, /synthetic/);
  });
  it('accepts health-data consent only for MyHealthOpinions members', async () => {
    const t2o = (await as('panel_manager').get('/panels/panelists?brand=turn2opinion&take=1')).body.rows[0];
    assert.equal((await as('panel_manager').post(`/panels/panelists/${t2o.id}/consents`, { purpose: 'health_data', granted: true })).status, 400);
    const r = await as('panel_manager').post(`/panels/panelists/${t2o.id}/consents`, { purpose: 'marketing_email', granted: false });
    assert.equal(r.status, 201);
  });
  it('deletes a panelist only after an approved deletion request', async () => {
    const p = (await as('panel_manager').get('/panels/panelists?take=1')).body.rows[0];
    const req = await as('panel_manager').post(`/panels/panelists/${p.id}/deletion-request`);
    assert.equal(req.status, 201);
    assert.equal((await as('panel_manager').get(`/panels/panelists/${p.id}`)).body.status, 'deletion_requested');
    assert.equal((await as('project_manager').post(`/approvals/${req.body.approval.id}/decision`, { decision: 'approved' })).status, 403);
    assert.equal((await as('platform_admin').post(`/approvals/${req.body.approval.id}/decision`, { decision: 'approved' })).status, 200);
    assert.equal((await as('panel_manager').get(`/panels/panelists/${p.id}`)).status, 404);
  });
  it('keeps panels away from roles without access', async () => {
    assert.equal((await as('bizdev').get('/panels/summary')).status, 403);
  });
});

describe('approvals visibility', () => {
  it('shows vendors no approvals and clients only their own publish requests', async () => {
    assert.deepEqual((await as('vendor').get('/approvals')).body, []);
    const c = (await as('client').get('/approvals')).body;
    assert.ok(c.every((a: { kind: string }) => a.kind === 'Publishing surveys'));
  });
});

/**
 * Phase 5 tests: survey results from real responses, respondent quality flags, approval-gated
 * respondent rejection (quota places released), the PowerPoint report and the DIY research flow.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, h, setup, teardown, type Res } from './harness';

const COMPLETE: Record<string, unknown> = { S1: 'ft', S2: 'lg', S3: 'final', S4: ['tech'], Q1: ['aws'], Q2: 'aws', Q3: 50, Q4: { posture: '3', identity: '3', workload: '3', data: '3' }, Q5: ['price', 'int', 'sup', 'comp'], Q6: 'flat', Q9: 8, Q10: 'ok', Q11: 4, END: '' };
async function interview(respondent: string, overrides: Record<string, unknown> = {}) {
  const s = await call('POST', '/r/sv-cloud/start', { source: 'panel:turn2opinion', respondent });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  let q: string | null = s.body.question.id;
  let last: Res | null = null;
  while (q) {
    last = await call('POST', `/r/session/${s.body.responseId}/answer`, { questionId: q, value: q in overrides ? overrides[q] : COMPLETE[q] });
    assert.equal(last.status, 200, `${q}: ${JSON.stringify(last.body)}`);
    q = last.body.outcome ? null : last.body.question.id;
  }
  return { id: s.body.responseId as string, outcome: last!.body.outcome as string };
}

before(async () => {
  await setup();
  const s = (await as('survey_programmer').get('/surveys/sv-cloud')).body;
  const fixed = { ...s.definition, rules: s.definition.rules.filter((r: { id: string }) => r.id !== 'r6') };
  assert.equal((await as('survey_programmer').put('/surveys/sv-cloud/definition', { definition: fixed, label: 'fix', baseVersion: s.currentVersion })).status, 200);
  await h.db.survey.update({ where: { id: 'sv-cloud' }, data: { status: 'Published' } });
});
after(teardown);

describe('results, quality and rejection', () => {
  const ids: string[] = [];
  it('flags speeders and duplicates on completion without removing them', async () => {
    const a = await interview('p-100');
    const b = await interview('p-100');
    const c = await interview('p-200', { Q10: 'asdfasdf' });
    assert.deepEqual([a.outcome, b.outcome, c.outcome], ['complete', 'complete', 'complete']);
    ids.push(a.id, b.id, c.id);
    const rows = await h.db.response.findMany({ where: { id: { in: ids } } });
    const by = Object.fromEntries(rows.map((r) => [r.id, r.flags]));
    assert.ok(by[a.id].includes('speeder'), 'finished in seconds');
    assert.ok(!by[a.id].includes('duplicate'));
    assert.ok(by[b.id].includes('duplicate'));
  });
  it('reports frequencies from completed responses with a banner', async () => {
    const r = await as('survey_programmer').get('/surveys/sv-cloud/results?banner=S2');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.base, 3);
    assert.equal(r.body.flagged, 3);
    assert.equal(r.body.banner.id, 'S2');
    const q1 = r.body.questions.find((q: { id: string }) => q.id === 'Q1');
    assert.equal(q1.rows.find((x: { code: string }) => x.code === 'aws').pct, 1);
    assert.equal((await as('survey_programmer').get('/surveys/sv-cloud/results?excludeFlagged=true')).body.base, 0);
    assert.equal((await as('vendor').get('/surveys/sv-cloud/results')).status, 403);
  });
  it('exports a PowerPoint report', async () => {
    const r = await fetch(`${h.url}/api/v1/surveys/sv-cloud/report.pptx?banner=S2`, { headers: { authorization: `Bearer ${h.tokens.survey_programmer}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /presentationml/);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK');
    assert.ok(buf.length > 20_000, `size ${buf.length}`);
    assert.ok(buf.includes(Buffer.from('ppt/slides/slide2.xml')));
  });
  it('rejects a respondent only through an approval, and releases the quota place', async () => {
    const cellsBefore = await h.db.quotaCell.findMany({ where: { surveyId: 'sv-cloud' }, orderBy: { key: 'asc' } });
    const projBefore = (await h.db.project.findUniqueOrThrow({ where: { id: 'pr-002' } })).completes;
    const req = await as('survey_programmer').post(`/surveys/sv-cloud/responses/${ids[1]}/reject`, { reason: 'Duplicate respondent' });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    assert.equal(req.body.approval.kind, 'Rejecting respondents');
    assert.equal((await as('survey_programmer').post(`/surveys/sv-cloud/responses/${ids[1]}/reject`, { reason: 'again' })).body.alreadyPending, true);
    assert.equal((await as('survey_programmer').post(`/approvals/${req.body.approval.id}/decision`, { decision: 'approved' })).status, 403);
    const ok = await as('project_manager').post(`/approvals/${req.body.approval.id}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.effect, /quota place/);
    const cellsAfter = await h.db.quotaCell.findMany({ where: { surveyId: 'sv-cloud' }, orderBy: { key: 'asc' } });
    assert.ok(cellsAfter.some((c, i) => c.count === cellsBefore[i].count - 1));
    assert.equal((await h.db.project.findUniqueOrThrow({ where: { id: 'pr-002' } })).completes, projBefore - 1);
    const res = (await as('survey_programmer').get('/surveys/sv-cloud/results')).body;
    assert.equal(res.base, 2);
    assert.equal(res.rejected, 1);
    const csv = String((await as('survey_programmer').get('/surveys/sv-cloud/responses.csv')).body);
    assert.match(csv.split('\n')[0], /quality_flags,rejected/);
  });
});

describe('DIY research', () => {
  const spec = { audience: 'B2C', countries: ['US', 'GB'], sampleSize: 600, incidence: 0.4, loi: 12 };
  it('gives clients an indicative range without vendor names or costs', async () => {
    const r = await as('client').get('/diy/estimate?audience=B2C&countries=US,GB&sampleSize=600&incidence=0.4&loi=12');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.basis, 'rate_card_estimate');
    assert.match(r.body.disclaimer, /Not a quote/);
    assert.ok(r.body.totalLow > 0 && r.body.totalHigh > r.body.totalLow);
    const text = JSON.stringify(r.body);
    const vendors = await h.db.vendor.findMany();
    assert.ok(vendors.every((v) => !text.includes(v.name) && !text.includes(v.id)));
  });
  it('turns a submission into a CRM opportunity and tells Business Development', async () => {
    const r = await as('client').post('/diy/requests', { ...spec, title: 'Snack brand tracker', objective: 'Track awareness of our snack brand quarterly.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const o = (await as('bizdev').get(`/opportunities/${r.body.id}`)).body;
    assert.equal(o.stage, 'New RFQ');
    assert.equal(o.channel, 'diy');
    assert.equal(o.clientId, 'cl-01');
    await h.drain();
    assert.ok((await as('bizdev').get('/notifications')).body.some((n: { title: string }) => /DIY request/.test(n.title)));
    const mine = (await as('client').get('/diy/requests')).body;
    assert.equal(mine[0].status, 'Received');
    assert.equal(mine[0].margin, undefined);
  });
  it('is submitted by clients only', async () => {
    assert.equal((await as('bizdev').post('/diy/requests', { ...spec, title: 'x x x', objective: 'internal attempt' })).status, 403);
    assert.equal((await as('vendor').get('/diy/requests')).status, 403);
  });
});

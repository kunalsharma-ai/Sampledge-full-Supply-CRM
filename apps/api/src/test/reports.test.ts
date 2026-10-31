/**
 * Reports and exports: PDF report, recodes (derived variables) and the SPSS .sav export.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeSav } from '../modules/spss';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const bin = async (p: string, who: string) => {
  const r = await fetch(`${h.url}/api/v1${p}`, { headers: { authorization: `Bearer ${h.tokens[who]}` } });
  return { status: r.status, type: r.headers.get('content-type') ?? '', body: Buffer.from(await r.arrayBuffer()) };
};

describe('PDF report', () => {
  it('renders the results as a PDF and records the export', async () => {
    const r = await bin('/surveys/sv-012/report.pdf?banner=S1', 'executive');
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/pdf/);
    assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(r.body.length > 5000);
    const log = (await as('platform_admin').get('/audit?entity=Survey&entityId=sv-012')).body as { action: string; after: { format?: string } }[];
    assert.ok(log.some((l) => l.action === 'survey.report_exported' && l.after?.format === 'pdf'));
  });
  it('refuses a survey with no completes and roles without analytics', async () => {
    assert.equal((await bin('/surveys/sv-cloud/report.pdf', 'executive')).status, 400);
    assert.equal((await bin('/surveys/sv-012/report.pdf', 'vendor')).status, 403);
  });
});

describe('recodes', () => {
  const top2 = { label: 'Satisfaction top-2 box', source: 'Q2', kind: 'group', groups: [{ code: 't2b', label: 'Satisfied (top 2)', from: ['5', '4'] }, { code: 'rest', label: 'Not satisfied', from: ['3', '2', '1'] }] };
  it('saves a recode that results, banners and explore views use like a question', async () => {
    const r = await as('data_processing').put('/dp/surveys/sv-012/recodes/R_Q2T2B', top2);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ov = (await as('data_processing').get('/dp/surveys/sv-012')).body;
    const rc = ov.recodes.find((x: { id: string }) => x.id === 'R_Q2T2B');
    assert.equal(rc.counts.t2b + rc.counts.rest + rc.unassigned, 600);
    const res = (await as('executive').get('/surveys/sv-012/results?banner=R_Q2T2B')).body;
    assert.equal(res.banner.id, 'R_Q2T2B');
    const q = res.questions.find((x: { id: string }) => x.id === 'R_Q2T2B');
    assert.equal(q.rows.find((x: { code: string }) => x.code === 't2b').count, rc.counts.t2b);
    const ex = (await as('executive').get('/surveys/sv-012/explore?from=R_Q2T2B&to=Q5')).body;
    assert.equal(ex.flow.ok, true, ex.flow.error);
  });
  it('validates against the questionnaire and audits changes', async () => {
    assert.equal((await as('data_processing').put('/dp/surveys/sv-012/recodes/Q2', top2)).status, 400);
    assert.match((await as('data_processing').put('/dp/surveys/sv-012/recodes/R_BAD', { ...top2, groups: [{ code: 'a', label: 'A', from: ['9'] }] })).body.message, /not an answer code/);
    assert.equal((await as('data_processing').put('/dp/surveys/sv-012/recodes/R_SPEND', { label: 'Spend', source: 'Q4', kind: 'bands', groups: [{ code: 'lo', label: 'Low', min: 0, max: 40 }, { code: 'hi', label: 'High', min: 40, max: 999 }] })).status, 400);
    assert.equal((await as('data_processing').put('/dp/surveys/sv-012/recodes/R_SPEND', { label: 'Spend', source: 'Q4', kind: 'bands', groups: [{ code: 'lo', label: 'Low', min: 0, max: 39.99 }, { code: 'hi', label: 'High', min: 40, max: 999 }] })).status, 200);
    assert.equal((await as('executive').put('/dp/surveys/sv-012/recodes/R_X', top2)).status, 403);
    assert.equal((await as('data_processing').delete('/dp/surveys/sv-012/recodes/R_SPEND')).status, 200);
    assert.equal((await as('data_processing').delete('/dp/surveys/sv-012/recodes/R_SPEND')).status, 404);
    const log = (await as('platform_admin').get('/audit?entity=Survey&entityId=sv-012')).body as { action: string }[];
    assert.ok(['dp.recode_created', 'dp.recode_deleted'].every((a) => log.some((l) => l.action === a)));
  });
});

describe('SPSS export', () => {
  it('writes a valid system file header, dictionary and one case per complete', async () => {
    const r = await bin('/dp/surveys/sv-012/data.sav', 'data_processing');
    assert.equal(r.status, 200);
    const b = r.body;
    assert.equal(b.subarray(0, 4).toString(), '$FL2');
    assert.equal(b.readInt32LE(64), 2); // layout code
    assert.equal(b.readInt32LE(80), 600); // cases
    assert.equal(b.readDoubleLE(84), 100); // bias
    assert.match(b.subarray(109, 173).toString(), /^CX Benchmark Telecom \(includes SYNTHETIC demo data\)/);
    const text = b.toString('latin1');
    assert.ok(text.includes('R_Q2T2B=R_Q2T2B') && text.includes('Q3_APP=Q3_app'), 'long variable names');
    assert.ok(text.includes('Satisfied (top 2)') && text.includes('Very satisfied'), 'value labels');
    assert.ok(text.includes('UTF-8'));
    assert.equal((await bin('/dp/surveys/sv-012/data.sav', 'vendor')).status, 403);
  });

  it('pads strings, splits long ones across slots and keeps UTF-8 characters whole', () => {
    const buf = writeSav([{ name: 'id', label: 'Id', kind: 'string', width: 12 }, { name: 'score', label: 'Score', kind: 'numeric', values: [{ value: 1, label: 'Low' }] }], [['abcé'.repeat(4), 1], ['x', null]], { now: new Date(Date.UTC(2026, 9, 31, 12, 0, 0)) });
    assert.equal(buf.readInt32LE(68), 3); // 2 slots for the 12-byte string + 1 numeric
    const data = buf.subarray(buf.length - 2 * 24);
    assert.equal(data.subarray(0, 16).toString('utf8').trimEnd(), 'abcéabcéab'); // 12 bytes max, no split character
    assert.equal(data.readDoubleLE(16), 1);
    assert.equal(data.readDoubleLE(40), -Number.MAX_VALUE); // system-missing
    assert.equal(buf.subarray(92, 109).toString(), '31 Oct 2612:00:00');
  });
});

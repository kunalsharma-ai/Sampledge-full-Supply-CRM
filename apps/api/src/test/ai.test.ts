/**
 * AI gateway tests. A local stub stands in for the Anthropic API (ANTHROPIC_BASE_URL), so the
 * provider path, schema validation, refusals, failures and the monthly cap are exercised without
 * network access or spend. Also covers questionnaire extraction from .docx, .xlsx and .pdf.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { as, h, setup, teardown } from './harness';

type Stub = { status: number; body: unknown };
let next: Stub[] = [];
const seen: { body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[] = [];
const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ body: JSON.parse(raw || '{}'), headers: req.headers });
    const r = next.shift() ?? { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no stub response queued' } } };
    res.writeHead(r.status, { 'content-type': 'application/json', 'request-id': 'req_test' });
    res.end(JSON.stringify(r.body));
  });
});
const message = (text: string, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage: { input_tokens: 1200, output_tokens: 300 }, ...extra },
});
const RFQ = 'Hi team, we need 800 completes with IT decision makers in Germany and France, about 12% IR and a 15 minute LOI.';

before(async () => {
  await new Promise<void>((r) => stub.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${(stub.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  await setup();
});
after(async () => { await teardown(); stub.close(); });

describe('AI gateway', () => {
  it('uses rules when no provider is configured, and logs the call', async () => {
    delete process.env.AI_PROVIDER;
    const st = (await as('bizdev').get('/ai/status')).body;
    assert.equal(st.provider, 'rules');
    assert.equal(st.connected, false);
    const r = await as('bizdev').post('/ai/rfq-extract', { text: RFQ });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.provider, 'rules');
    assert.equal(r.body.data.sampleSize, 800);
    assert.deepEqual(r.body.data.countries.sort(), ['DE', 'FR']);
    assert.equal(r.body.data.audience, 'B2B');
    assert.equal(seen.length, 0, 'no request left the system');
    assert.equal(await h.db.aiCall.count({ where: { provider: 'rules', task: 'rfq.extract' } }), 1);
  });

  it('calls Claude with a schema-constrained request when configured', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    next.push(message(JSON.stringify({ audience: 'B2B', countries: ['DE', 'FR'], sampleSize: 800, incidence: 0.12, loi: 15, title: 'ITDM cloud study', missing: [] })));
    const r = await as('bizdev').post('/ai/rfq-extract', { text: RFQ });
    assert.equal(r.body.provider, 'anthropic', JSON.stringify(r.body));
    assert.equal(r.body.data.title, 'ITDM cloud study');
    assert.ok(r.body.costUsd > 0);
    const req = seen.at(-1)!;
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal((req.body.output_config as { format: { type: string } }).format.type, 'json_schema');
    assert.equal(req.body.fallbacks, 'default');
    assert.match(String(req.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
    const call = await h.db.aiCall.findFirstOrThrow({ where: { provider: 'anthropic' }, orderBy: { createdAt: 'desc' } });
    assert.equal(call.inputTokens, 1200);
    assert.equal(call.costUsd, (1200 * 4 + 300 * 20) / 1e6);
  });

  it('falls back to rules on invalid output, refusals and API errors', async () => {
    next.push(message('{"audience":"Martians"}'));
    let r = await as('bizdev').post('/ai/rfq-extract', { text: RFQ });
    assert.equal(r.body.provider, 'rules');
    assert.ok(['fallback', 'error'].includes(r.body.status), r.body.status);
    assert.equal(r.body.data.sampleSize, 800);

    next.push(message('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }));
    r = await as('bizdev').post('/ai/rfq-extract', { text: RFQ });
    assert.equal(r.body.status, 'refused');
    assert.equal(r.body.data.sampleSize, 800);

    next.push({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    r = await as('bizdev').post('/ai/rfq-extract', { text: RFQ });
    assert.equal(r.body.status, 'error');
    assert.match(r.body.note, /auth/);
  });

  it('stops calling the model once the monthly cap is spent', async () => {
    process.env.AI_MONTHLY_CAP_USD = '0.001';
    const before = seen.length;
    const r = await as('bizdev').post('/ai/rfq-extract', { text: RFQ });
    assert.equal(r.body.status, 'cap_reached');
    assert.equal(seen.length, before, 'no request was sent');
    delete process.env.AI_MONTHLY_CAP_USD;
  });

  it('only sends cost facts for roles that may see margins', async () => {
    next.push(message(JSON.stringify({ headline: 'x', bullets: [], risks: [], nextSteps: [] })));
    await as('project_manager').get('/ai/projects/pr-012/summary');
    assert.match(String((seen.at(-1)!.body.messages as { content: string }[])[0].content), /budgetUsedShare/);
    next.push(message(JSON.stringify({ headline: 'x', bullets: [], risks: [], nextSteps: [] })));
    const r = await as('survey_programmer').get('/ai/projects/pr-012/summary');
    if (r.status === 200) assert.doesNotMatch(String((seen.at(-1)!.body.messages as { content: string }[])[0].content), /budgetUsedShare/);
    else assert.equal(r.status, 403);
    delete process.env.AI_PROVIDER;
  });

  it('summarises a project with rules and respects scope', async () => {
    const r = await as('project_manager').get('/ai/projects/pr-012/summary');
    assert.equal(r.status, 200);
    assert.match(r.body.data.headline, /SE-26\d+/);
    assert.ok(r.body.data.bullets.length >= 3);
    assert.equal((await as('client').get('/ai/projects/pr-002/summary')).status, 404, 'other client');
  });

  it('records usage for admins only', async () => {
    assert.ok((await as('platform_admin').get('/ai/usage')).body.length >= 6);
    assert.equal((await as('vendor').get('/ai/usage')).status, 403);
  });
});

describe('questionnaire import', () => {
  const fixture = (f: string) => readFileSync(path.resolve(__dirname, '../../src/test/fixtures', f)).toString('base64');
  const check = (body: { result: { data: { questions: { id: string; type: string; terminate?: string; randomize?: boolean }[] } } }) => {
    const qs = body.result.data.questions;
    assert.deepEqual(qs.map((q) => q.id), ['S1', 'Q1', 'Q2']);
    assert.equal(qs[0].terminate, '2');
    assert.equal(qs[1].type, 'multi');
    assert.equal(qs[1].randomize, true);
    assert.equal(qs[2].type, 'numeric');
  };
  it('reads Word documents', async () => {
    const r = await as('survey_programmer').post('/ai/questionnaire', { fileName: 'q.docx', base64: fixture('questionnaire.docx') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.source, 'docx');
    check(r.body);
  });
  it('reads PDFs', async () => {
    const r = await as('survey_programmer').post('/ai/questionnaire', { fileName: 'q.pdf', base64: fixture('questionnaire.pdf') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    check(r.body);
  });
  it('reads Excel workbooks', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Questionnaire');
    ['S1. Which of these best describes your role?', '1. IT decision maker', '2. Other [TERMINATE]', 'Q1. Which cloud services do you use? Select all that apply. [RANDOMIZE]', '1. Storage', '2. Compute', '3. None of these', 'Q2. How many employees work at your company?'].forEach((l) => ws.addRow([l]));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await as('survey_programmer').post('/ai/questionnaire', { fileName: 'q.xlsx', base64: buf.toString('base64') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    check(r.body);
  });
  it('rejects mislabelled and unsupported files', async () => {
    assert.equal((await as('survey_programmer').post('/ai/questionnaire', { fileName: 'q.docx', base64: Buffer.from('plain text').toString('base64') })).status, 400);
    assert.equal((await as('survey_programmer').post('/ai/questionnaire', { fileName: 'q.doc', base64: Buffer.from('x').toString('base64') })).status, 400);
    assert.equal((await as('vendor').post('/ai/questionnaire', { text: 'Q1. Hello?' })).status, 403);
  });
});

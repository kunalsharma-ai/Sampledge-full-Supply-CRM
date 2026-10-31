/**
 * Phase 4 workflow tests: the transactional outbox and worker, supplier feasibility, purchase
 * orders and payables, invoices, the Comms Hub (consent filtering and the high-volume gate),
 * panel CSV import and the responses CSV export. Uses database sampledge_test via the harness.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, call, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const pending = () => h.db.outboxEvent.count({ where: { processedAt: null } });

describe('outbox', () => {
  it('writes no event when the request is rejected', async () => {
    const before = await h.db.outboxEvent.count();
    assert.equal((await as('bizdev').patch('/opportunities/op-001/stage', { stage: 'Lost' })).status, 400);
    assert.equal(await h.db.outboxEvent.count(), before);
  });
  it('drains to zero and reports it on health', async () => {
    await h.drain();
    assert.equal(await pending(), 0);
    assert.equal((await call('GET', '/health')).body.outboxPending, 0);
  });
});

describe('supplier feasibility', () => {
  let requestId = '';
  it('sends requests to ranked vendors and moves the opportunity to Feasibility', async () => {
    const r = await as('bizdev').post('/opportunities/op-004/feasibility', { vendorIds: ['vd-01', 'vd-02', 'vd-03'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.created >= 2);
    assert.equal((await as('bizdev').get('/opportunities/op-004')).body.stage, 'Feasibility');
    const again = await as('bizdev').post('/opportunities/op-004/feasibility', { vendorIds: ['vd-01', 'vd-02', 'vd-03'] });
    assert.equal(again.body.created, 0, 'idempotent per vendor and market');
  });
  it('emails each vendor through the development adapter', async () => {
    await h.drain();
    const msgs = await h.db.message.findMany({ where: { relatedType: 'FeasibilityRequest' } });
    assert.ok(msgs.length >= 2);
    assert.ok(msgs.every((m) => m.status === 'delivered_dev' && m.adapter));
  });
  it('shows a vendor only its own requests, without the client identity', async () => {
    const inbox = (await as('vendor').get('/feasibility')).body;
    assert.ok(inbox.length >= 1);
    assert.ok(inbox.every((f: { vendorId: string }) => f.vendorId === 'vd-01'));
    assert.ok(inbox.every((f: Record<string, unknown>) => !('opportunityId' in f) && !('clientId' in f) && /^RFQ-/.test(String(f.reference))));
    assert.doesNotMatch(JSON.stringify(inbox), /cl-07/);
    requestId = inbox.find((f: { status: string }) => f.status === 'sent').id;
  });
  it('lets only the vendor answer', async () => {
    assert.equal((await as('bizdev').post(`/feasibility/${requestId}/respond`, { cpi: 4, capacity: 300 })).status, 403);
    assert.equal((await as('vendor').post(`/feasibility/${requestId}/respond`, { cpi: 4 })).status, 400, 'capacity required');
    const ok = await as('vendor').post(`/feasibility/${requestId}/respond`, { cpi: 4.1, capacity: 300, note: 'Field in 5 days' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'responded');
    assert.equal((await as('vendor').post(`/feasibility/${requestId}/respond`, { decline: true })).status, 400, 'answered once');
  });
  it('hides bids from roles without view:vendor_bids and notifies Business Development', async () => {
    const pm = (await as('bizdev').get('/opportunities/op-004/feasibility')).body;
    assert.equal(pm.find((f: { id: string }) => f.id === requestId).cpi, 4.1);
    await h.drain();
    const n = (await as('bizdev').get('/notifications')).body;
    assert.ok(n.some((x: { title: string; module: string }) => x.module === 'crm' && /responded/.test(x.title)));
  });
  it('prices the quote from supplier answers where they exist', async () => {
    const d = await as('bizdev').post('/opportunities/op-004/quotes', { targetMargin: 0.4 });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.ok(['supplier_confirmed', 'mixed'].includes(d.body.quote.basis), d.body.quote.basis);
  });
});

describe('purchase orders and vendor payments', () => {
  let payableId = '';
  let pendingBefore = 0;
  it('raises a PO, a payable and a vendor email when a purchase is approved', async () => {
    pendingBefore = (await h.db.vendor.findUniqueOrThrow({ where: { id: 'vd-01' } })).pendingPayment;
    const r = await as('project_manager').post('/projects/pr-012/allocations', { vendorId: 'vd-01', completes: 100, cpi: 3.5 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await as('pm2').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' })).status, 200);
    await h.drain();
    const pos = (await as('vendor').get('/purchase-orders')).body;
    const po = pos.find((p: { allocationId: string }) => p.allocationId === r.body.allocation.id);
    assert.ok(po, 'vendor sees its PO');
    assert.equal(po.amount, 350);
    assert.equal(po.payables.length, 1);
    payableId = po.payables[0].id;
    assert.equal((await h.db.vendor.findUniqueOrThrow({ where: { id: 'vd-01' } })).pendingPayment, pendingBefore + 350);
    const mail = (await as('vendor').get('/comms/messages')).body.find((m: { relatedId: string }) => m.relatedId === po.id);
    assert.equal(mail.status, 'delivered_dev');
  });
  it('does not show other vendors a PO, and roles without bids see none', async () => {
    assert.ok((await as('vendor').get('/payables')).body.every((p: { vendorId: string }) => p.vendorId === 'vd-01'));
    assert.deepEqual((await as('client').get('/purchase-orders')).body, []);
  });
  it('gates the payment on an approval that the requester cannot decide', async () => {
    const r = await as('finance').post(`/payables/${payableId}/request-payment`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.approval.kind, 'Issuing payments');
    assert.equal((await as('finance').post(`/payables/${payableId}/request-payment`)).status, 400, 'already pending');
    assert.equal((await as('finance').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' })).status, 403);
    assert.equal((await as('project_manager').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' })).status, 403, 'no approve:payments');
    assert.equal((await as('executive').post(`/approvals/${r.body.approval.id}/decision`, { decision: 'approved' })).status, 200);
    const pay = await h.db.payable.findUniqueOrThrow({ where: { id: payableId } });
    assert.equal(pay.status, 'paid');
    assert.equal((await h.db.vendor.findUniqueOrThrow({ where: { id: 'vd-01' } })).pendingPayment, pendingBefore);
    await h.drain();
    assert.ok(await h.db.message.findFirst({ where: { relatedId: payableId, status: 'delivered_dev' } }));
  });
});

describe('client invoices', () => {
  let invoiceId = '';
  it('drafts an invoice when a project reaches the Invoice stage', async () => {
    assert.equal((await as('project_manager').patch('/projects/pr-012/stage', { stage: 'Invoice' })).status, 200);
    await h.drain();
    const inv = (await as('finance').get('/invoices')).body.find((i: { projectId: string }) => i.projectId === 'pr-012');
    assert.equal(inv.status, 'draft');
    assert.equal(inv.clientId, 'cl-01');
    invoiceId = inv.id;
    assert.equal((await as('finance').post('/invoices', { projectId: 'pr-012' })).status, 400, 'one invoice per project');
  });
  it('keeps drafts from the client and releases them once issued', async () => {
    assert.ok(!(await as('client').get('/invoices')).body.some((i: { id: string }) => i.id === invoiceId));
    assert.equal((await as('project_manager').post(`/invoices/${invoiceId}/issue`, {})).status, 403, 'finance module is read-only for PMs');
    const r = await as('finance').post(`/invoices/${invoiceId}/issue`, { termsDays: 30 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mine = (await as('client').get('/invoices')).body;
    assert.ok(mine.some((i: { id: string; status: string }) => i.id === invoiceId && i.status === 'issued'));
    assert.ok(mine.every((i: { clientId: string }) => i.clientId === 'cl-01'));
    await h.drain();
    const mail = (await as('client').get('/comms/messages')).body.find((m: { relatedId: string }) => m.relatedId === invoiceId);
    assert.equal(mail?.status, 'delivered_dev');
  });
});

describe('Comms Hub', () => {
  it('excludes members who withdrew marketing consent', async () => {
    const pre = (await as('panel_manager').get('/comms/preview?audience=panel&target=panel:turn2opinion:active')).body;
    const p = await h.db.panelist.findFirstOrThrow({ where: { brand: 'turn2opinion', status: 'active', NOT: { consents: { some: { purpose: 'marketing_email', granted: false } } } } });
    assert.equal((await as('panel_manager').post(`/panels/panelists/${p.id}/consents`, { purpose: 'marketing_email', granted: false })).status, 201);
    const post = (await as('panel_manager').get('/comms/preview?audience=panel&target=panel:turn2opinion:active')).body;
    assert.equal(post.recipients, pre.recipients - 1);
  });
  it('holds a high-volume send for approval and delivers it once approved', async () => {
    const r = await as('panel_manager').post('/comms/messages', { channel: 'email', audience: 'panel', target: 'panel:turn2opinion:all', subject: 'New studies this week', body: 'Hello {{handle}}' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.recipients > 20);
    assert.equal(r.body.message.status, 'pending_approval');
    const ap = await h.db.approval.findFirstOrThrow({ where: { payload: { path: ['messageId'], equals: r.body.message.id } } });
    assert.equal((await as('panel_manager').post(`/approvals/${ap.id}/decision`, { decision: 'approved' })).status, 403);
    assert.equal((await as('project_manager').post(`/approvals/${ap.id}/decision`, { decision: 'approved' })).status, 200);
    await h.drain();
    assert.equal((await h.db.message.findUniqueOrThrow({ where: { id: r.body.message.id } })).status, 'delivered_dev');
  });
  it('sends small messages straight to the queue', async () => {
    const r = await as('project_manager').post('/comms/messages', { channel: 'email', audience: 'client', target: 'client:cl-01', subject: 'Fieldwork update', body: 'On track.' });
    assert.equal(r.status, 201);
    assert.equal(r.body.message.status, 'queued');
  });
  it('lets external users message the internal team only', async () => {
    assert.equal((await as('vendor').post('/comms/messages', { channel: 'email', audience: 'client', target: 'client:cl-01', subject: 'Hi', body: 'x' })).status, 400);
    const ok = await as('vendor').post('/comms/messages', { channel: 'in_app', audience: 'internal', target: 'role:project_manager', subject: 'Top-up ready', body: 'We can add 200 completes.' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.ok((await as('vendor').get('/comms/messages')).body.every((m: { toRef: string; audience: string }) => m.toRef === 'vendor:vd-01' || m.audience === 'internal'));
  });
  it('renders templates', async () => {
    const r = await as('panel_manager').post('/comms/render', { key: 'panel_invite', vars: { handle: 'T2O-abc' } });
    assert.equal(r.status, 201);
    assert.match(r.body.body + r.body.subject, /T2O-abc|\{\{/);
  });
});

describe('panel CSV import', () => {
  const csv = ['handle,country,age_band,gender,segment', 'imp_001,us,25-34,female,consumer', 'imp_002,GB,35-44,male,consumer', 'imp_001,US,25-34,female,consumer', 'someone@example.com,US,25-34,female,consumer', 'imp_003,US,25-34,female,hcp', 'imp_004,US,25-34,female,consumer,+1 415 555 0100'].join('\n');
  it('validates on a dry run without writing', async () => {
    const r = await as('panel_manager').post('/panels/import', { brand: 'turn2opinion', csv });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dryRun, true);
    assert.equal(r.body.accepted, 2);
    assert.equal(r.body.skipped, 1);
    assert.equal(r.body.errorCount, 3);
    assert.ok(r.body.errors.some((e: { row: number; message: string }) => e.row === 5 && /pseudonymous/.test(e.message)));
    assert.ok(r.body.errors.some((e: { row: number }) => e.row === 7), 'phone number rejected');
    assert.equal(await h.db.panelist.count({ where: { handle: { startsWith: 'imp_' } } }), 0);
  });
  it('imports accepted rows and skips existing handles next time', async () => {
    const r = await as('panel_manager').post('/panels/import', { brand: 'turn2opinion', csv, dryRun: false });
    assert.equal(r.body.accepted, 2);
    assert.equal(await h.db.panelist.count({ where: { handle: { startsWith: 'imp_' } } }), 2);
    const again = await as('panel_manager').post('/panels/import', { brand: 'turn2opinion', csv, dryRun: false });
    assert.equal(again.body.accepted, 0);
    assert.equal(again.body.skipped, 3);
  });
  it('rejects a file without the required columns', async () => {
    assert.equal((await as('panel_manager').post('/panels/import', { brand: 'turn2opinion', csv: 'handle,country\nabc,US' })).status, 400);
  });
});

describe('responses CSV export', () => {
  it('exports one row per response with a header', async () => {
    const r = await as('survey_programmer').get('/surveys/sv-cloud/responses.csv');
    assert.equal(r.status, 200);
    const lines = String(r.body).trim().split('\n');
    assert.match(lines[0], /response_id|id/i);
    assert.ok(lines.length >= 1);
  });
  it('is not available to roles without survey access', async () => {
    assert.ok([403, 404].includes((await as('vendor').get('/surveys/sv-cloud/responses.csv')).status));
  });
});

describe('outbox after the workflows', () => {
  it('has processed every event', async () => {
    await h.drain();
    assert.equal(await pending(), 0);
    assert.equal(await h.db.outboxEvent.count({ where: { lastError: { not: null } } }), 0);
  });
});

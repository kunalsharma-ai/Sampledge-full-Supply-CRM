/**
 * Multi-currency documents, PO reconciliation, the incentives ledger, and forecast vs actuals.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';

let t: string;
before(async () => {
  await setup();
  t = (await h.db.tenant.findFirstOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

describe('currencies', () => {
  it('records rates, fixes the base once documents exist, and sets party currencies', async () => {
    const c = await as('finance').get('/finance/currencies');
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.base, 'USD');
    assert.ok(c.body.rates.some((r: { currency: string }) => r.currency === 'EUR'));
    const r = await as('finance').post('/finance/rates', { currency: 'eur', rate: 1.1 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.currency, 'EUR');
    assert.equal((await as('finance').get('/finance/currencies')).body.rates.find((x: { currency: string }) => x.currency === 'EUR').rate, 1.1);
    assert.equal((await as('finance').post('/finance/rates', { currency: 'USD', rate: 2 })).status, 400, 'base is always 1');
    assert.equal((await as('finance').post('/finance/rates', { currency: 'EURO', rate: 2 })).status, 400);
    assert.equal((await as('finance').put('/finance/currencies/base', { currency: 'EUR' })).status, 400, 'documents exist');
    assert.equal((await as('finance').put('/finance/currencies/party', { kind: 'client', id: 'cl-02', currency: 'JPY' })).status, 400, 'no JPY rate');
    assert.equal((await as('finance').put('/finance/currencies/party', { kind: 'client', id: 'cl-02', currency: 'EUR' })).status, 200);
    assert.equal((await as('vendor').get('/finance/currencies')).status, 403);
    assert.equal((await as('project_manager').post('/finance/rates', { currency: 'EUR', rate: 1 })).status, 403, 'read-only finance access');
    assert.equal((await as('platform_admin').get('/audit?action=fx.rate_set')).body[0].after.rate, 1.1);
  });

  it('drafts an invoice in the client’s currency at the recorded rate and totals in the base', async () => {
    const pr = await h.db.project.findFirstOrThrow({ where: { tenantId: t, completes: { gt: 0 }, clientId: { not: 'cl-02' } } });
    await h.db.invoice.deleteMany({ where: { projectId: pr.id } });
    await h.db.client.update({ where: { id: pr.clientId }, data: { currency: 'EUR' } });
    const before = (await as('finance').get('/finance/summary')).body;
    const inv = await as('finance').post('/invoices', { projectId: pr.id });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.equal(inv.body.currency, 'EUR');
    assert.equal(inv.body.fxRate, 1.1);
    assert.equal(inv.body.cpi, Math.round((pr.cpiSell / 1.1) * 100) / 100);
    assert.equal((await as('finance').post(`/invoices/${inv.body.id}/issue`, { termsDays: 30 })).status, 200);
    const after = (await as('finance').get('/finance/summary')).body;
    assert.equal(after.currency, 'USD');
    assert.ok(Math.abs(after.receivable - before.receivable - inv.body.amount * 1.1) <= 1, 'receivable grows by the base value');
    await h.db.client.update({ where: { id: pr.clientId }, data: { currency: 'USD' } });
  });

  it('raises a purchase order in the vendor’s currency', async () => {
    await h.db.vendor.update({ where: { id: 'vd-03' }, data: { currency: 'GBP' } });
    const pr = await h.db.project.findFirstOrThrow({ where: { tenantId: t } });
    const al = await h.db.allocation.create({ data: { tenantId: t, projectId: pr.id, vendorId: 'vd-03', completes: 100, cpi: 5.08, status: 'approved' } });
    await h.db.outboxEvent.create({ data: { tenantId: t, type: 'allocation.approved', payload: { allocationId: al.id } } });
    await h.drain();
    const po = await h.db.purchaseOrder.findUniqueOrThrow({ where: { allocationId: al.id }, include: { payables: true } });
    assert.equal(po.currency, 'GBP');
    assert.equal(po.fxRate, 1.27);
    assert.equal(po.cpi, 4);
    assert.equal(po.amount, 400);
    assert.equal(po.payables[0].currency, 'GBP');
    await h.db.vendor.update({ where: { id: 'vd-03' }, data: { currency: 'USD' } });
  });
});

describe('reconciliation', () => {
  it('lists POs against recorded completes and adjusts the open payable when fewer are accepted', async () => {
    const list = await as('finance').get('/finance/reconciliation');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const open = list.body.find((r: { payableStatus: string; reconciledAt: string | null }) => r.payableStatus === 'open' && !r.reconciledAt);
    assert.ok(open, 'an open PO to reconcile');
    assert.equal((await as('finance').post(`/finance/reconciliation/${open.id}`, { acceptedCompletes: open.ordered - 10 })).status, 400, 'a shortfall needs a reason');
    assert.equal((await as('finance').post(`/finance/reconciliation/${open.id}`, { acceptedCompletes: open.ordered + 1, note: 'x' })).status, 400, 'not more than ordered');
    const ok = await as('finance').post(`/finance/reconciliation/${open.id}`, { acceptedCompletes: open.ordered - 10, note: '10 removed in quality checks' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.payableAmount, Math.round((open.ordered - 10) * open.cpi));
    const pay = await h.db.payable.findFirstOrThrow({ where: { purchaseOrderId: open.id } });
    assert.equal(pay.amount, ok.body.payableAmount);
    assert.equal((await h.db.purchaseOrder.findUniqueOrThrow({ where: { id: open.id } })).status, 'closed');
    assert.equal((await as('finance').post(`/finance/reconciliation/${open.id}`, { acceptedCompletes: 1, note: 'x' })).status, 400, 'once only');
    const paid = list.body.find((r: { payableStatus: string }) => r.payableStatus === 'paid');
    if (paid) assert.equal((await as('finance').post(`/finance/reconciliation/${paid.id}`, { acceptedCompletes: paid.ordered })).status, 400, 'already paid');
    assert.equal((await as('platform_admin').get('/audit?action=po.reconciled')).body[0].after.note, '10 removed in quality checks');
    assert.equal((await as('vendor').get('/finance/reconciliation')).status, 403);
  });
});

describe('incentives ledger', () => {
  it('posts earnings at once and holds redemptions for someone else’s approval', async () => {
    const p = await h.db.panelist.findFirstOrThrow({ where: { tenantId: t } });
    await h.db.panelist.update({ where: { id: p.id }, data: { points: 0 } });
    const earn = await as('finance').post('/finance/incentives', { panelistId: p.id, kind: 'earn', points: 500 });
    assert.equal(earn.status, 201, JSON.stringify(earn.body));
    assert.equal(earn.body.valueBase, 5);
    const red = await as('finance').post('/finance/incentives', { panelistId: p.id, kind: 'redeem', points: 200 });
    assert.equal(red.status, 201, JSON.stringify(red.body));
    assert.equal(red.body.status, 'pending_approval');
    assert.equal((await h.db.panelist.findUniqueOrThrow({ where: { id: p.id } })).points, 500, 'points stay until approved');
    const over = await as('finance').post('/finance/incentives', { panelistId: p.id, kind: 'redeem', points: 400 });
    assert.equal(over.status, 400, 'pending redemptions are reserved');
    assert.match(over.body.message, /300/);
    assert.equal((await as('finance').post(`/approvals/${red.body.approvalId}/decision`, { decision: 'approved' })).status, 403, 'the requester cannot decide');
    const dec = await as('executive').post(`/approvals/${red.body.approvalId}/decision`, { decision: 'approved' });
    assert.equal(dec.status, 200, JSON.stringify(dec.body));
    assert.match(dec.body.effect, /Redemption posted/);
    assert.equal((await h.db.panelist.findUniqueOrThrow({ where: { id: p.id } })).points, 300);
    assert.equal((await as('finance').post('/finance/incentives', { panelistId: p.id, kind: 'adjust', points: -50 })).status, 400, 'adjustments need a reason');
    assert.equal((await as('finance').post('/finance/incentives', { panelistId: p.id, kind: 'expire', points: -5 })).status, 400, 'signed only for adjustments');
    const led = await as('finance').get('/finance/incentives');
    assert.equal(led.status, 200);
    assert.equal(led.body.thisMonth.earn.points, 500);
    assert.equal(led.body.thisMonth.redeem.points, -200);
    assert.ok(led.body.liability > 0);
    assert.equal(led.body.entries[0].panelist.handle, p.handle);
    assert.equal((await as('client').get('/finance/incentives')).status, 403);
  });
});

describe('forecast vs actuals', () => {
  it('compares planned and invoiced revenue and cost by month and by project, in the base currency', async () => {
    const f = await as('finance').get('/finance/forecast');
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.equal(f.body.months.length, 10);
    assert.equal(f.body.base, 'USD');
    const sum = (k: string) => f.body.months.reduce((s: number, m: Record<string, number>) => s + m[k], 0);
    assert.ok(sum('forecastRevenue') > 0);
    assert.ok(f.body.projects.some((p: { actualRevenue: number }) => p.actualRevenue > 0));
    assert.ok(f.body.projects.some((p: { actualCost: number }) => p.actualCost > 0));
    assert.ok('forecastCost' in f.body.months[0], 'finance sees costs');
    assert.equal((await as('vendor').get('/finance/forecast')).status, 403);
  });
});

/**
 * Command Center metrics: every KPI is counted from the workspace's records, trends and comparisons
 * come only from recorded daily history, revenue comes from invoices and purchase orders, daily
 * fieldwork from respondent records. Cost and margin are removed for roles without view:margins,
 * and another workspace's records never count.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InsightsService, KPI_KEYS } from '../modules/insights';
import { asTenant } from '../common/tenant-scope';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const day = 86400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
let tenantId = '';

describe('Command Center overview', () => {
  before(async () => {
    tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  });

  it('counts KPIs from the records', async () => {
    const r = await as('executive').get('/insights/overview');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const k = r.body.kpis;
    assert.deepEqual(Object.keys(k).sort(), [...KPI_KEYS].sort());
    const active = await h.db.project.count({ where: { tenantId, stage: { notIn: ['Project Closure', 'Invoice'] } } });
    assert.equal(k.active_projects.value, active);
    assert.equal(k.active_panelists.value, await h.db.panelist.count({ where: { tenantId, status: 'active' } }));
    assert.equal(k.new_requests.value, await h.db.opportunity.count({ where: { tenantId, stage: 'New RFQ' } }));
    assert.equal(k.active_surveys.value, await h.db.survey.count({ where: { tenantId, status: 'Published' } }));
    const vendors = await h.db.allocation.findMany({ where: { tenantId, status: { in: ['approved', 'live'] } }, distinct: ['vendorId'], select: { vendorId: true } });
    assert.equal(k.active_vendors.value, vendors.length);
    const open = await h.db.invoice.findMany({ where: { tenantId, status: { in: ['draft', 'issued'] } } });
    assert.equal(k.pending_invoices.value, Math.round(open.reduce((s, i) => s + i.amount * i.fxRate, 0)));
    assert.equal(r.body.pendingInvoiceCount, open.length);
  });

  it('shows no trend or comparison without recorded history', async () => {
    await h.db.metricSnapshot.deleteMany({});
    const r = await as('executive').get('/insights/overview');
    for (const key of KPI_KEYS) {
      assert.deepEqual(r.body.kpis[key].spark, [], `${key} has no history yet`);
      assert.equal(r.body.kpis[key].delta, null);
    }
    // Opening the overview recorded today's values.
    assert.equal(await h.db.metricSnapshot.count({ where: { tenantId, day: utcDay(new Date()) } }), KPI_KEYS.length);
  });

  it('builds trends and the 30-day comparison from snapshots', async () => {
    const today = utcDay(new Date());
    const current = (await as('executive').get('/insights/overview')).body.kpis.active_projects.value as number;
    await h.db.metricSnapshot.createMany({ data: [
      { tenantId, day: new Date(today.getTime() - 30 * day), key: 'active_projects', value: current / 2 },
      { tenantId, day: new Date(today.getTime() - 2 * day), key: 'active_projects', value: current - 1 },
      { tenantId, day: new Date(today.getTime() - 1 * day), key: 'active_projects', value: current },
    ] });
    const k = (await as('executive').get('/insights/overview')).body.kpis.active_projects;
    assert.deepEqual(k.spark, [current - 1, current, current]);
    assert.equal(k.delta, 1, 'doubled since 30 days ago');
    assert.equal(k.comparedWith, new Date(today.getTime() - 30 * day).toISOString().slice(0, 10));
  });

  it('reports invoiced revenue, purchase cost and the forecast', async () => {
    const p = await h.db.project.findFirstOrThrow({ where: { tenantId } });
    const now = new Date();
    const before = (await as('executive').get('/insights/overview')).body;
    const thisMonth = () => before.revenue.months[11];
    await h.db.invoice.create({ data: { tenantId, number: 'INV-T-1', clientId: p.clientId, projectId: p.id, completes: 10, cpi: 100, amount: 1000, currency: 'EUR', fxRate: 1.1, status: 'issued', issuedAt: now } });
    await h.db.invoice.create({ data: { tenantId, number: 'INV-T-2', clientId: p.clientId, projectId: p.id, completes: 10, cpi: 100, amount: 5000, status: 'void', issuedAt: now } });
    await h.db.invoice.create({ data: { tenantId, number: 'INV-T-3', clientId: p.clientId, projectId: p.id, completes: 10, cpi: 70, amount: 700, status: 'draft' } });
    const r = (await as('executive').get('/insights/overview')).body;
    assert.equal(r.revenue.months.length, 12);
    assert.equal(r.revenue.months[11].revenue - thisMonth().revenue, 1100, 'EUR invoice converted, void ignored');
    assert.equal(r.kpis.monthly_revenue.value - before.kpis.monthly_revenue.value, 1100);
    assert.equal(r.revenue.forecast.length, 3);
    assert.equal(r.revenue.forecast[0].draftInvoices - before.revenue.forecast[0].draftInvoices, 700);
    const open = await h.db.opportunity.findMany({ where: { tenantId, stage: { notIn: ['Won', 'Lost'] } } });
    assert.equal(r.revenue.weightedPipeline, Math.round(open.reduce((s, o) => s + o.value * o.probability, 0)));
    assert.ok('cost' in r.revenue.months[11]);
  });

  it('counts daily completes and incidence from respondent records', async () => {
    const sv = await h.db.survey.findFirstOrThrow({ where: { tenantId } });
    const before = (await as('executive').get('/insights/overview')).body.fieldwork.at(-1);
    const now = new Date();
    const base = { tenantId, surveyId: sv.id, version: 1, source: 'test', answers: {}, path: [], completedAt: now };
    await h.db.response.createMany({ data: [
      { ...base, respondent: 'f1', outcome: 'complete' }, { ...base, respondent: 'f2', outcome: 'complete' }, { ...base, respondent: 'f3', outcome: 'complete' },
      { ...base, respondent: 'f4', outcome: 'screenout' },
      { ...base, respondent: 'f5', outcome: 'complete', rejectedAt: now }, // removed from results: not counted
    ] });
    const fw = (await as('executive').get('/insights/overview')).body.fieldwork;
    assert.equal(fw.length, 30);
    const t = fw.at(-1);
    assert.equal(t.day, now.toISOString().slice(0, 10));
    assert.equal(t.completes - before.completes, 3);
    assert.equal(t.screenouts - before.screenouts, 1);
    assert.equal(t.incidence, Math.round((t.completes / (t.completes + t.screenouts)) * 100) / 100);
  });

  it('removes cost and margin for roles without view:margins', async () => {
    const s = h.app.get(InsightsService);
    const ctx = { userId: 'u', sessionId: 's', tenantId, role: 'survey_programmer' as const, name: 'x', email: 'x', vendorId: null, clientId: null };
    const o = await asTenant(tenantId, () => s.overview(ctx));
    assert.equal(o.kpis.margin, undefined);
    assert.ok(!('cost' in o.revenue.months[0]));
  });

  it('is limited to roles with Command Center or CRM access', async () => {
    assert.equal((await as('survey_programmer').get('/insights/overview')).status, 403);
    assert.equal((await as('vendor').get('/insights/overview')).status, 403);
    assert.equal((await as('client').get('/crm/insights/revenue')).status, 403);
    const crm = await as('bizdev').get('/crm/insights/revenue');
    assert.equal(crm.status, 200);
    assert.equal(crm.body.months.length, 12);
  });

  it('never counts another workspace', async () => {
    const r = await as('iso').get('/insights/overview');
    assert.equal(r.status, 200);
    assert.equal(r.body.kpis.active_panelists.value, 0);
    assert.equal(r.body.kpis.active_projects.value, 1);
    assert.equal(r.body.revenue.months.reduce((s: number, m: { revenue: number }) => s + m.revenue, 0), 0);
  });

  it('the worker records a snapshot for every workspace', async () => {
    await h.db.metricSnapshot.deleteMany({});
    const n = await h.app.get(InsightsService).snapshotAll();
    assert.equal(n, await h.db.tenant.count());
    assert.equal(await h.db.metricSnapshot.count(), n * KPI_KEYS.length);
    await h.app.get(InsightsService).snapshotAll(); // same day: overwritten, not duplicated
    assert.equal(await h.db.metricSnapshot.count(), n * KPI_KEYS.length);
  });
});

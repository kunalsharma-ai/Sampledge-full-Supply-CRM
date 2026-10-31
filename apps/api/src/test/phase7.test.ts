/**
 * Closing the known limitations: exploratory views on recorded responses, per-person notification
 * read state, cursor paging on the remaining lists, and the database tenant scope on public routes.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaService } from '../common/prisma.service';
import { enterTenant, tenantScope } from '../common/tenant-scope';
import { AuthService } from '../auth/auth.service';
import { RuntimeService } from '../modules/runtime';
import { as, demoEmail, DEMO_PASSWORD, h, setup, teardown } from './harness';

before(setup);
after(teardown);

describe('survey explore views', () => {
  it('builds flow, trend and segments from the recorded synthetic responses', async () => {
    const r = await as('executive').get('/surveys/sv-012/explore');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.base, 600);
    assert.equal(r.body.synthetic, 600);
    assert.equal(r.body.flow.ok, true, r.body.flow.error);
    assert.equal(r.body.flow.data.from.id, 'S1');
    assert.equal(r.body.flow.data.to.id, 'Q5');
    assert.equal(r.body.trend.ok, true);
    assert.equal(r.body.trend.data.points.reduce((s: number, p: { completes: number }) => s + p.completes, 0), 600);
    assert.equal(r.body.segments.ok, true, r.body.segments.error);
    assert.equal(r.body.segments.data.k, 3);
  });

  it('takes the flow pair, trend metric and k from the query', async () => {
    const r = await as('executive').get('/surveys/sv-012/explore?from=Q1&to=Q2&trendQ=Q5&interval=week&k=4');
    assert.equal(r.body.flow.data.from.id, 'Q1');
    assert.equal(r.body.trend.data.interval, 'week');
    assert.equal(r.body.trend.data.metric.kind, 'nps');
    assert.equal(r.body.segments.data.k, 4);
  });

  it('reports a view it cannot build without failing the others', async () => {
    const r = await as('executive').get('/surveys/sv-012/explore?from=Q1&to=Q1&trendQ=Q6');
    assert.equal(r.status, 200);
    assert.equal(r.body.flow.ok, false);
    assert.match(r.body.flow.error, /different/);
    assert.equal(r.body.trend.ok, false);
    assert.equal(r.body.segments.ok, true);
  });

  it('is limited to roles with analytics access and to the caller’s tenant', async () => {
    assert.equal((await as('vendor').get('/surveys/sv-012/explore')).status, 403);
    assert.equal((await as('iso').get('/surveys/sv-012/explore')).status, 404);
    assert.equal((await as('executive').get('/surveys/sv-012/explore?k=9')).status, 400);
  });
});

describe('notification read state per person', () => {
  it('marking all read for one person leaves a colleague with the same role unread', async () => {
    const mine = (await as('project_manager').get('/notifications')).body as { id: string; read: boolean }[];
    assert.ok(mine.some((n) => !n.read), 'the project manager starts with unread notifications');
    const before2 = (await as('pm2').get('/notifications')).body as { id: string; read: boolean }[];
    const r = await as('project_manager').post('/notifications/read-all');
    assert.equal(r.status, 200);
    assert.ok(r.body.updated > 0);
    assert.ok(((await as('project_manager').get('/notifications')).body as { read: boolean }[]).every((n) => n.read));
    const after2 = (await as('pm2').get('/notifications')).body as { id: string; read: boolean }[];
    assert.deepEqual(after2.map((n) => n.read), before2.map((n) => n.read));
    assert.equal((await as('project_manager').post('/notifications/read-all')).body.updated, 0);
  });

  it('marks a single notification read, only for notifications the caller can see', async () => {
    const list = (await as('pm2').get('/notifications')).body as { id: string; read: boolean }[];
    const target = list.find((n) => !n.read)!;
    assert.equal((await as('pm2').post(`/notifications/${target.id}/read`)).status, 200);
    const again = (await as('pm2').get('/notifications')).body as { id: string; read: boolean }[];
    assert.equal(again.find((n) => n.id === target.id)!.read, true);
    assert.equal(again.filter((n) => !n.read).length, list.filter((n) => !n.read).length - 1);
    assert.equal((await as('iso').post(`/notifications/${target.id}/read`)).status, 404);
  });
});

describe('cursor paging on every growing list', () => {
  const lists: [string, string][] = [
    ['/projects', 'platform_admin'], ['/clients', 'platform_admin'], ['/opportunities', 'platform_admin'], ['/surveys', 'platform_admin'],
    ['/approvals', 'platform_admin'], ['/invoices', 'finance'], ['/purchase-orders', 'finance'], ['/payables', 'finance'],
    ['/vendors', 'platform_admin'], ['/allocations', 'platform_admin'],
  ];
  const get = (p: string, who: string) => fetch(`${h.url}/api/v1${p}`, { headers: { authorization: `Bearer ${h.tokens[who]}` } });
  for (const [p, who] of lists) {
    it(`${p} walks every row exactly once, one per page`, async () => {
      const all = (await (await get(p, who)).json()) as { id: string }[];
      assert.ok(all.length > 1, `${p} has ${all.length} rows in the seed`);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 400; i++) {
        const r = await get(`${p}${p.includes('?') ? '&' : '?'}take=1${cursor ? `&cursor=${cursor}` : ''}`, who);
        assert.equal(r.status, 200);
        const rows = (await r.json()) as { id: string }[];
        assert.ok(rows.length <= 1);
        seen.push(...rows.map((x) => x.id));
        cursor = r.headers.get('x-next-cursor');
        if (!cursor) break;
      }
      assert.deepEqual(seen, all.map((x) => x.id));
    });
  }
});

describe('database tenant scope on public routes', () => {
  const seen = async () => {
    const db = h.app.get(PrismaService);
    const [r] = await db.$transaction((tx) => tx.$queryRaw<{ t: string | null }[]>`SELECT current_setting('app.tenant_id', true) AS t`);
    return r.t;
  };
  const tenantOf = async (slug: string) => (await h.db.tenant.findFirstOrThrow({ where: slug === 'demo' ? { slug: 'sampledge-demo' } : { slug: { not: 'sampledge-demo' } } })).id;

  it('a respondent session runs under the survey’s tenant once the survey is found', async () => {
    const rt = h.app.get(RuntimeService);
    const demo = await tenantOf('demo');
    let id = '';
    await tenantScope.run({}, async () => {
      assert.equal(await seen(), '');
      // A staff preview: the route is public, so nothing has set a tenant before the survey lookup.
      const staff = { tenantId: demo, role: 'survey_programmer', userId: 'u', name: 'Test' } as unknown as Parameters<RuntimeService['start']>[2];
      const s = await rt.start('sv-cloud', { preview: true }, staff);
      assert.equal(await seen(), demo);
      id = s.responseId;
    });
    await tenantScope.run({}, async () => {
      await rt.state(id);
      assert.equal(await seen(), demo);
    });
  });

  it('sign-in writes the session under the chosen workspace', async () => {
    const auth = h.app.get(AuthService);
    const iso = await tenantOf('iso');
    await tenantScope.run({}, async () => {
      await auth.login('admin@isolation.sampledge.test', DEMO_PASSWORD);
      assert.equal(await seen(), iso);
    });
    await tenantScope.run({}, async () => {
      await auth.login(demoEmail('finance'), DEMO_PASSWORD);
      assert.equal(await seen(), await tenantOf('demo'));
    });
  });

  it('refuses to move a scoped request to another workspace', async () => {
    await tenantScope.run({ tenantId: 'tenant-a' }, async () => {
      assert.throws(() => enterTenant('tenant-b'), /another workspace/);
      enterTenant('tenant-a');
    });
  });

  it('the worker handles each event as its tenant', async () => {
    const iso = await tenantOf('iso');
    const db = h.app.get(PrismaService);
    // An event for the isolation tenant naming a demo-tenant project. The handler looks the project
    // up by id alone; handled as the isolation tenant, the database hides it, so no invoice is drafted.
    const invoiced = (await h.db.invoice.findMany({ select: { projectId: true } })).map((i) => i.projectId);
    const demoProject = await h.db.project.findFirstOrThrow({ where: { tenantId: await tenantOf('demo'), id: { notIn: invoiced } } });
    const ev = await db.outboxEvent.create({ data: { tenantId: iso, type: 'project.stage_changed', payload: { projectId: demoProject.id, to: 'Invoice' } } });
    await h.drain();
    assert.ok((await h.db.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).processedAt, 'the event was processed');
    assert.equal(await h.db.invoice.count({ where: { projectId: demoProject.id } }), 0);
  });
});

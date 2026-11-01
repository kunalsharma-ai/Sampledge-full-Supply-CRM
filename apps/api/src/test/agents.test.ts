/**
 * Automation agents run for real: each run is logged with what it examined and produced, agents
 * start paused, scheduled runs are claimed once, consequential steps become approvals a person
 * decides, and agents that cannot run here cannot be switched on.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentsService } from '../modules/agents';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

let tenantId = '';
type A = { id: string; key: string; enabled: boolean; available: boolean; runs30d: number; successRate: number | null; settings: Record<string, number>; nextRunAt: string | null };
const agent = async (key: string) => ((await as('platform_admin').get('/agents')).body as A[]).find((a) => a.key === key)!;

describe('automation agents', () => {
  before(async () => {
    tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
  });

  it('lists every agent, paused, with no invented statistics', async () => {
    const r = await as('platform_admin').get('/agents');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 12);
    for (const a of r.body as A[]) {
      assert.equal(a.enabled, false);
      assert.equal(a.runs30d, 0);
      assert.equal(a.successRate, null);
    }
    assert.equal((r.body as A[]).filter((a) => a.available).length, 8);
    assert.equal((await as('vendor').get('/agents')).status, 403);
  });

  it('creates the agents for a workspace that has none', async () => {
    const r = await as('iso').get('/agents');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 12);
    assert.ok((r.body as A[]).every((a) => a.id !== 'ag-01'), 'its own rows, not the demo workspace\'s');
  });

  it('refuses to switch on an agent that cannot run here, and needs edit:automations', async () => {
    const sp = await agent('survey-programming');
    const r = await as('platform_admin').patch(`/agents/${sp.id}`, { enabled: true });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /language model/);
    const pm = await agent('project-health');
    assert.equal((await as('executive').patch(`/agents/${pm.id}`, { enabled: true })).status, 403);
    assert.equal((await as('executive').post(`/agents/${pm.id}/run`)).status, 403);
  });

  it('validates settings', async () => {
    const q = await agent('respondent-quality');
    assert.deepEqual(q.settings, { minFlags: 2 });
    assert.equal((await as('platform_admin').patch(`/agents/${q.id}`, { settings: { minFlags: 9 } })).status, 400);
    assert.equal((await as('platform_admin').patch(`/agents/${q.id}`, { settings: { other: 1 } })).status, 400);
    assert.equal((await as('platform_admin').patch(`/agents/${(await agent('panel-engagement')).id}`, { settings: { x: 1 } })).status, 400);
    const ok = await as('platform_admin').patch(`/agents/${q.id}`, { settings: { minFlags: 1 }, everyMinutes: 30 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual((await agent('respondent-quality')).settings, { minFlags: 1 });
    assert.equal(await h.db.auditLog.count({ where: { action: 'agent.configure', entityId: q.id } }), 1);
  });

  it('respondent quality: asks for approval once, and the approval rejects the interviews', async () => {
    const sv = await h.db.survey.findFirstOrThrow({ where: { tenantId, projectId: { not: null } } });
    const base = { tenantId, surveyId: sv.id, version: 1, source: 'test', answers: {}, path: [], outcome: 'complete', completedAt: new Date() };
    await h.db.response.createMany({ data: [
      { ...base, respondent: 'aq-1', flags: ['speeder', 'straightliner'] },
      { ...base, respondent: 'aq-2', flags: ['duplicate'] },
    ] });
    const ids = (await h.db.response.findMany({ where: { respondent: { in: ['aq-1', 'aq-2'] } }, select: { id: true } })).map((r) => r.id);
    const q = await agent('respondent-quality');
    const run = await as('project_manager').post(`/agents/${q.id}/run`);
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.equal(run.body.status, 'succeeded');
    assert.ok(run.body.approvals >= 1);
    const ap = await h.db.approval.findFirstOrThrow({ where: { agentId: q.id, kind: 'Rejecting respondents', payload: { path: ['surveyId'], equals: sv.id } } });
    const asked = (ap.payload as { responseIds: string[] }).responseIds;
    assert.ok(ids.every((id) => asked.includes(id)), 'both interviews (minFlags 1) are in the request');
    // A second run does not ask about the same interviews again.
    const again = await as('project_manager').post(`/agents/${q.id}/run`);
    assert.equal(again.body.approvals, 0);
    // A person approves: the interviews leave the results.
    const projectBefore = await h.db.project.findUniqueOrThrow({ where: { id: sv.projectId! } });
    const d = await as('platform_admin').post(`/approvals/${ap.id}/decision`, { decision: 'approved' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.match(d.body.effect, /interviews rejected/);
    assert.equal(await h.db.response.count({ where: { id: { in: ids }, rejectedAt: { not: null } } }), 2);
    const projectAfter = await h.db.project.findUniqueOrThrow({ where: { id: sv.projectId! } });
    assert.ok(projectAfter.completes <= projectBefore.completes - 2 || projectBefore.completes < 2);
  });

  it('project health: alerts on nearly full quotas once a day', async () => {
    const p = await h.db.project.findFirstOrThrow({ where: { tenantId, stage: 'Full Launch' } });
    await h.db.quotaCell.create({ data: { tenantId, projectId: p.id, key: 'agent-test-cell', label: 'Agent test cell', target: 100, count: 95 } });
    const pm = await agent('project-health');
    const r1 = await as('platform_admin').post(`/agents/${pm.id}/run`);
    assert.equal(r1.body.status, 'succeeded');
    assert.equal(await h.db.notification.count({ where: { tenantId, title: 'Quota "Agent test cell" is 95% full' } }), 1);
    await as('platform_admin').post(`/agents/${pm.id}/run`);
    assert.equal(await h.db.notification.count({ where: { tenantId, title: 'Quota "Agent test cell" is 95% full' } }), 1, 'not repeated within a day');
  });

  it('panel engagement: drafts re-engagement messages that wait for approval', async () => {
    const pe = await agent('panel-engagement');
    const r = await as('platform_admin').post(`/agents/${pe.id}/run`);
    assert.equal(r.body.status, 'succeeded', JSON.stringify(r.body));
    assert.ok(r.body.messages >= 1);
    const msgs = await h.db.message.findMany({ where: { tenantId, createdBy: 'Panel Engagement Agent' } });
    assert.ok(msgs.length >= 1);
    assert.ok(msgs.every((m) => m.toRef.endsWith(':dormant')));
    const big = msgs.filter((m) => m.status === 'pending_approval');
    for (const m of big) assert.ok(await h.db.approval.findFirst({ where: { id: m.approvalId!, agentId: pe.id, kind: 'High-volume communications' } }));
    const again = await as('platform_admin').post(`/agents/${pe.id}/run`);
    assert.equal(again.body.messages, 0, 'one set per week');
  });

  it('survey QA, pipeline, finance, supplier and digest agents run and log', async () => {
    for (const key of ['survey-qa', 'pipeline-followup', 'finance-overdue', 'supplier-delivery', 'executive-digest']) {
      const a = await agent(key);
      const r = await as('platform_admin').post(`/agents/${a.id}/run`);
      assert.equal(r.status, 201, `${key}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.status, 'succeeded', `${key}: ${r.body.error}`);
      assert.ok(r.body.summary.length > 0);
    }
    assert.ok(await h.db.notification.findFirst({ where: { tenantId, title: { startsWith: 'Weekly operations digest' } } }));
    const qa = await agent('survey-qa');
    const second = await as('platform_admin').post(`/agents/${qa.id}/run`);
    assert.equal(second.body.examined, 0, 'versions already checked are not checked again');
  });

  it('scheduled runs: switched-on agents run when due, once, and are logged', async () => {
    const pm = await agent('finance-overdue');
    const on = await as('platform_admin').patch(`/agents/${pm.id}`, { enabled: true });
    assert.equal(on.status, 200);
    const svc = h.app.get(AgentsService);
    const before = await h.db.agentRun.count({ where: { agentId: pm.id, trigger: 'schedule' } });
    const [a, b] = await Promise.all([svc.runDue(new Date(Date.now() + 1000)), svc.runDue(new Date(Date.now() + 1000))]);
    assert.ok(a + b >= 1);
    assert.equal(await h.db.agentRun.count({ where: { agentId: pm.id, trigger: 'schedule' } }), before + 1, 'claimed by one worker only');
    const row = await h.db.agent.findUniqueOrThrow({ where: { id: pm.id } });
    assert.ok(row.nextRunAt! > new Date(Date.now() + 60 * 60_000), 'next run is a schedule interval away');
    await svc.runDue();
    assert.equal(await h.db.agentRun.count({ where: { agentId: pm.id, trigger: 'schedule' } }), before + 1, 'not due again yet');
    const list = await agent('finance-overdue');
    assert.ok(list.runs30d >= 2);
    assert.equal(list.successRate, 1);
    await as('platform_admin').patch(`/agents/${pm.id}`, { enabled: false });
  });

  it('a failing run is rolled back and logged as failed', async () => {
    const svc = h.app.get(AgentsService);
    const a = await h.db.agent.findFirstOrThrow({ where: { tenantId, key: 'respondent-quality' } });
    await h.db.agent.update({ where: { id: a.id }, data: { settings: { minFlags: 'not a number' } } });
    const run = await svc.execute(a, 'manual', 'test');
    assert.equal(run.status, 'failed');
    assert.ok(run.error);
    await h.db.agent.update({ where: { id: a.id }, data: { settings: { minFlags: 2 } } });
    const runs = await as('platform_admin').get('/agents/runs');
    assert.equal(runs.body[0].status, 'failed');
    const daily = await as('platform_admin').get('/agents/daily');
    assert.equal(daily.body.length, 14);
    assert.ok(daily.body[13].failed >= 1 && daily.body[13].succeeded >= 1);
  });
});

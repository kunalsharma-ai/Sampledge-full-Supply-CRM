/**
 * Engagement workflows (SUPPLY360 automation): a workflow record is checked before it can be
 * activated, then the engine enrols members who meet the trigger after activation, follows the
 * yes/no paths, waits on delays and performs the actions through the Comms Hub and the ledger.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, h, setup, teardown } from './harness';
import { WorkflowEngine, delayUntil, graphProblems, type WfNode } from '../modules/workflows';

let tenantId = '';
before(async () => {
  await setup();
  tenantId = (await h.db.tenant.findUniqueOrThrow({ where: { slug: 'sampledge-demo' } })).id;
});
after(teardown);

const node = (id: string, kind: WfNode['kind'], type: string, config: WfNode['config'] = {}): WfNode => ({ id, kind, type, config, x: 0, y: 0 });
const graph = {
  nodes: [
    node('t', 'trigger', 'signup', { panel: 'Any' }),
    node('c', 'condition', 'country', { country: 'DE' }),
    node('e', 'action', 'email', { template: 'Welcome' }),
    node('b', 'action', 'bonus', { points: 25 }),
    node('w', 'delay', 'wait', { hours: 24 }),
    node('g', 'action', 'tag', { tag: 'welcomed' }),
  ],
  edges: [
    { id: 'e1', from: 't', to: 'c' },
    { id: 'e2', from: 'c', to: 'e', branch: 'yes' as const },
    { id: 'e3', from: 'c', to: 'b', branch: 'no' as const },
    { id: 'e4', from: 'e', to: 'w' },
    { id: 'e5', from: 'w', to: 'g' },
  ],
};

describe('workflow checks', () => {
  it('lists what stops a graph from running', () => {
    assert.deepEqual(graphProblems(graph), []);
    const bad = graphProblems({ nodes: [...graph.nodes, node('o', 'condition', 'opened')], edges: [...graph.edges, { id: 'x', from: 'b', to: 't' }] });
    assert.ok(bad.some((p) => /open tracking/.test(p)));
    assert.ok(bad.some((p) => /loops/.test(p)));
    assert.ok(graphProblems({ nodes: [node('b', 'action', 'bonus', { points: 900 })], edges: [] }).some((p) => /exactly one trigger/.test(p)));
  });

  it('waits for the send window in the member’s country time', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    assert.equal(delayUntil(node('d', 'delay', 'window', { from: 9 }), 'IN', now).toISOString(), '2026-11-07T03:30:00.000Z');
    assert.equal(delayUntil(node('d', 'delay', 'window', { from: 9 }), 'US', now).toISOString(), '2026-11-06T14:00:00.000Z');
  });
});

describe('running a workflow', () => {
  it('refuses to activate a broken graph, then enrols, branches, waits and acts', async () => {
    assert.equal((await as('vendor').get('/supply/records/workflow')).status, 403);
    const draft = await as('panel_manager').post('/supply/records/workflow', { data: { name: 'Welcome series', panel: 'all', nodes: graph.nodes.slice(0, 1), edges: [] } });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.match(draft.body.ref, /^WF-/);
    const no = await as('panel_manager').post(`/supply/records/workflow/${draft.body.id}/activate`, { version: draft.body.version });
    assert.equal(no.status, 400);
    assert.match(no.body.message, /action/);
    const full = await as('panel_manager').patch(`/supply/records/workflow/${draft.body.id}`, { data: graph, version: draft.body.version });
    assert.equal(full.status, 200, JSON.stringify(full.body));

    const test = await as('panel_manager').post(`/supply/workflows/${draft.body.id}/test`, {});
    assert.equal(test.status, 200, JSON.stringify(test.body));
    assert.equal(test.body.path[0].node, 't');
    assert.equal(test.body.path[1].node, 'c');

    const on = await as('panel_manager').post(`/supply/records/workflow/${draft.body.id}/activate`, { version: full.body.version });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.status, 'active');
    assert.equal((await as('panel_manager').patch(`/supply/records/workflow/${draft.body.id}`, { data: { name: 'Renamed' }, version: on.body.version })).status, 400, 'pause before editing');

    const engine = h.app.get(WorkflowEngine);
    assert.equal(await engine.runDue(new Date()), 0, 'members who joined before activation are not enrolled');

    const mk = (handle: string, country: string) => h.db.panelist.create({ data: { tenantId, brand: 'turn2opinion', handle, country, ageBand: '25-34', gender: 'f', segment: 'consumer', status: 'active', qualityScore: 0.9, profileCompletion: 0.4, joinedAt: new Date(Date.now() + 1000) } });
    const de = await mk('wf-test-de', 'DE');
    const fr = await mk('wf-test-fr', 'FR');
    const soon = new Date(Date.now() + 5000);
    assert.equal(await engine.runDue(soon), 2);

    const runs = (await as('panel_manager').get(`/supply/workflows/${draft.body.id}/runs`)).body;
    assert.equal(runs.stats.runs7d, 2);
    const rde = await h.db.workflowRun.findUniqueOrThrow({ where: { workflowId_panelistId: { workflowId: draft.body.id, panelistId: de.id } } });
    assert.equal(rde.status, 'waiting');
    assert.equal(rde.nodeId, 'g');
    const m = await h.db.message.findFirstOrThrow({ where: { tenantId, relatedType: 'Workflow', relatedId: draft.body.id } });
    assert.equal(m.toRef, `panelist:${de.id}`);
    assert.match(m.subject, /Welcome to Turn2Opinion/);

    const rfr = await h.db.workflowRun.findUniqueOrThrow({ where: { workflowId_panelistId: { workflowId: draft.body.id, panelistId: fr.id } } });
    assert.equal(rfr.status, 'completed');
    assert.equal((await h.db.panelist.findUniqueOrThrow({ where: { id: fr.id } })).points, 25);
    assert.ok(await h.db.incentiveEntry.findFirst({ where: { panelistId: fr.id, kind: 'adjust', note: `Automation bonus, workflow ${draft.body.ref}` } }));

    assert.equal(await engine.runDue(new Date(Date.now() + 10_000)), 0, 'still waiting, and nobody is enrolled twice');
    await engine.runDue(new Date(Date.now() + 25 * 3600_000));
    assert.equal((await h.db.workflowRun.findUniqueOrThrow({ where: { id: rde.id } })).status, 'completed');
    assert.ok(await h.db.panelistAttribute.findFirst({ where: { panelistId: de.id, key: 'tag:welcomed', source: 'automation' } }));

    const off = await as('panel_manager').post(`/supply/records/workflow/${draft.body.id}/pause`, { version: on.body.version });
    assert.equal(off.body.status, 'paused');
    const audit = (await h.db.auditLog.findMany({ where: { tenantId, entityId: draft.body.id } })).map((a) => a.action);
    for (const a of ['workflow.created', 'workflow.activate', 'workflow.pause']) assert.ok(audit.includes(a), a);
  });
});

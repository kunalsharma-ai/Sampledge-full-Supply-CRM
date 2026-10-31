/**
 * Client deliverables: the team releases files from a survey's results; reports go straight to the
 * client, respondent-level data waits for a "Releasing sensitive datasets" approval. Clients see and
 * download only released files on their own projects, byte-for-byte what was released.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

const bin = async (p: string, who: string) => {
  const r = await fetch(`${h.url}/api/v1${p}`, { headers: { authorization: `Bearer ${h.tokens[who]}` } });
  return { status: r.status, type: r.headers.get('content-type') ?? '', sha: r.headers.get('x-content-sha256'), body: Buffer.from(await r.arrayBuffer()) };
};
type D = { id: string; status: string; kind: string; sha256: string; approvalId: string | null; fileName: string };

let projectId = '';

describe('client deliverables', () => {
  before(async () => {
    const s = await h.db.survey.findUniqueOrThrow({ where: { id: 'sv-012' } });
    projectId = s.projectId!;
    await h.db.project.update({ where: { id: projectId }, data: { clientId: 'cl-01' } });
  });

  it('releases a PDF report straight to the client, who downloads exactly that file', async () => {
    const r = await as('project_manager').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'report_pdf', note: 'Topline for the steering group' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = r.body as D;
    assert.equal(d.status, 'released');
    const list = (await as('client').get('/deliverables')).body as D[];
    assert.ok(list.some((x) => x.id === d.id));
    assert.ok(!('content' in list[0]), 'list never carries file bytes');
    const f = await bin(`/deliverables/${d.id}/download`, 'client');
    assert.equal(f.status, 200);
    assert.match(f.type, /application\/pdf/);
    assert.equal(f.body.subarray(0, 5).toString(), '%PDF-');
    assert.equal(createHash('sha256').update(f.body).digest('hex'), d.sha256);
    assert.equal(f.sha, d.sha256);
    assert.ok(await h.db.auditLog.findFirst({ where: { action: 'deliverable.download', entityId: d.id } }));
    assert.equal((await h.db.deliverable.findUniqueOrThrow({ where: { id: d.id } })).downloads, 1);
    const msg = await h.db.outboxEvent.findFirst({ where: { type: 'deliverable.released' }, orderBy: { createdAt: 'desc' } });
    assert.ok(msg, 'client notification queued');
  });

  it('holds respondent-level data until someone else approves the release', async () => {
    const r = await as('project_manager').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'data_sav' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = r.body as D;
    assert.equal(d.status, 'pending_approval');
    assert.ok(d.approvalId);
    assert.ok(!((await as('client').get('/deliverables')).body as D[]).some((x) => x.id === d.id), 'hidden while pending');
    assert.equal((await bin(`/deliverables/${d.id}/download`, 'client')).status, 404);
    const own = await as('project_manager').post(`/approvals/${d.approvalId}/decision`, { decision: 'approved' });
    assert.equal(own.status, 403, 'the requester cannot decide');
    const ok = await as('platform_admin').post(`/approvals/${d.approvalId}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.effect, /Released to the client/);
    const f = await bin(`/deliverables/${d.id}/download`, 'client');
    assert.equal(f.status, 200);
    assert.equal(f.body.subarray(0, 4).toString(), '$FL2', 'SPSS file');
  });

  it('keeps a declined or withdrawn file away from the client', async () => {
    const r = (await as('project_manager').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'responses_csv' })).body as D;
    await as('platform_admin').post(`/approvals/${r.approvalId}/decision`, { decision: 'rejected' });
    assert.equal((await h.db.deliverable.findUniqueOrThrow({ where: { id: r.id } })).status, 'rejected');
    assert.equal((await bin(`/deliverables/${r.id}/download`, 'client')).status, 404);
    const rep = (await as('project_manager').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'tables_xlsx' })).body as D;
    assert.equal((await bin(`/deliverables/${rep.id}/download`, 'client')).status, 200);
    assert.equal((await as('project_manager').post(`/deliverables/${rep.id}/withdraw`)).status, 201);
    assert.equal((await bin(`/deliverables/${rep.id}/download`, 'client')).status, 404);
  });

  it('lets only the research team release, and only from a survey on that project', async () => {
    assert.equal((await as('client').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'report_pdf' })).status, 403);
    assert.equal((await as('executive').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'report_pdf' })).status, 403, 'read-only role');
    assert.equal((await as('vendor').get('/deliverables')).status, 403);
    const other = await h.db.project.findFirstOrThrow({ where: { id: { not: projectId } } });
    assert.equal((await as('project_manager').post('/deliverables', { projectId: other.id, surveyId: 'sv-012', kind: 'report_pdf' })).status, 400);
  });

  it('shows clients only their own projects', async () => {
    const d = (await as('project_manager').post('/deliverables', { projectId, surveyId: 'sv-012', kind: 'report_pptx' })).body as D;
    await h.db.project.update({ where: { id: projectId }, data: { clientId: 'cl-02' } });
    assert.ok(!((await as('client').get('/deliverables')).body as D[]).some((x) => x.id === d.id));
    assert.equal((await bin(`/deliverables/${d.id}/download`, 'client')).status, 404);
    await h.db.project.update({ where: { id: projectId }, data: { clientId: 'cl-01' } });
  });
});

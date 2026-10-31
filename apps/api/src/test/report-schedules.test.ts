/**
 * Scheduled report delivery: a due schedule releases the report to the client once (even when two
 * workers race), tells the client through the Comms Hub, and moves to the next run. Respondent-level
 * data cannot be scheduled, and a schedule stops working if its owner loses the access to release.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextRun, ReportSchedulesService } from '../modules/report-schedules';
import { as, h, setup, teardown } from './harness';

before(setup);
after(teardown);

let projectId = '';
type S = { id: string; nextRunAt: string; lastResult: string | null; lastDeliverableId: string | null; active: boolean };

describe('next run', () => {
  it('finds the next daily and weekly slot in UTC', () => {
    const from = new Date('2026-10-31T10:30:00Z'); // a Saturday
    assert.equal(nextRun(from, { frequency: 'daily', weekday: null, hourUtc: 9 }).toISOString(), '2026-11-01T09:00:00.000Z');
    assert.equal(nextRun(from, { frequency: 'daily', weekday: null, hourUtc: 11 }).toISOString(), '2026-10-31T11:00:00.000Z');
    assert.equal(nextRun(from, { frequency: 'weekly', weekday: 1, hourUtc: 8 }).toISOString(), '2026-11-02T08:00:00.000Z');
    assert.equal(nextRun(from, { frequency: 'weekly', weekday: 6, hourUtc: 10 }).toISOString(), '2026-11-07T10:00:00.000Z', 'same day but past the hour');
  });
});

describe('scheduled report delivery', () => {
  before(async () => {
    const s = await h.db.survey.findUniqueOrThrow({ where: { id: 'sv-012' } });
    projectId = s.projectId!;
    await h.db.project.update({ where: { id: projectId }, data: { clientId: 'cl-01' } });
  });

  it('refuses respondent-level data and non-team callers', async () => {
    const bad = await as('project_manager').post('/report-schedules', { projectId, surveyId: 'sv-012', kind: 'data_sav', frequency: 'daily', hourUtc: 8 });
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(bad.body), /approval each time/);
    assert.equal((await as('project_manager').post('/report-schedules', { projectId, surveyId: 'sv-012', kind: 'report_pdf', frequency: 'weekly', hourUtc: 8 })).status, 400, 'weekly needs a weekday');
    assert.equal((await as('client').post('/report-schedules', { projectId, surveyId: 'sv-012', kind: 'report_pdf', frequency: 'daily', hourUtc: 8 })).status, 403);
    assert.equal((await as('client').get('/report-schedules')).status, 403);
  });

  it('releases a due report once, notifies the client and schedules the next run', async () => {
    const r = await as('project_manager').post('/report-schedules', { projectId, surveyId: 'sv-012', kind: 'report_pdf', frequency: 'weekly', weekday: 1, hourUtc: 8 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const s = r.body as S;
    assert.equal(new Date(s.nextRunAt).getUTCDay(), 1);
    await h.db.reportSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    const svc = h.app.get(ReportSchedulesService);
    const [a, b] = await Promise.all([svc.runDue(), svc.runDue()]);
    assert.equal(a + b, 1, 'two racing workers run it once');
    const after = await h.db.reportSchedule.findUniqueOrThrow({ where: { id: s.id } });
    assert.match(after.lastResult ?? '', /^Released Report \(PDF\)/);
    assert.ok(after.nextRunAt > new Date());
    const d = await h.db.deliverable.findUniqueOrThrow({ where: { id: after.lastDeliverableId! } });
    assert.equal(d.status, 'released');
    assert.match(d.note ?? '', /Scheduled weekly delivery/);
    assert.ok(((await as('client').get('/deliverables')).body as { id: string }[]).some((x) => x.id === d.id), 'client sees it');
    await h.drain();
    const msg = await h.db.message.findFirst({ where: { relatedType: 'Deliverable', relatedId: d.id } });
    assert.ok(msg, 'client told through the Comms Hub');
    assert.equal(msg!.toRef, 'client:cl-01');
    assert.equal(await svc.runDue(), 0, 'nothing else due');
  });

  it('pauses and resumes', async () => {
    const s = (await as('project_manager').post('/report-schedules', { projectId, surveyId: 'sv-012', kind: 'tables_xlsx', frequency: 'daily', hourUtc: 6 })).body as S;
    assert.equal(((await as('project_manager').post(`/report-schedules/${s.id}/pause`)).body as S).active, false);
    await h.db.reportSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    assert.equal(await h.app.get(ReportSchedulesService).runDue(), 0, 'paused schedules do not run');
    const resumed = (await as('project_manager').post(`/report-schedules/${s.id}/resume`)).body as S;
    assert.equal(resumed.active, true);
    assert.ok(new Date(resumed.nextRunAt) > new Date(), 'resuming does not fire a missed run at once');
  });

  it('stops delivering when the owner can no longer release', async () => {
    const s = (await as('project_manager').post('/report-schedules', { projectId, surveyId: 'sv-012', kind: 'report_pptx', frequency: 'daily', hourUtc: 7 })).body as S;
    const pm = await h.db.membership.findFirstOrThrow({ where: { role: 'project_manager' } });
    await h.db.membership.update({ where: { id: pm.id }, data: { role: 'executive' } });
    await h.db.reportSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    const before = await h.db.deliverable.count();
    await h.app.get(ReportSchedulesService).runDue();
    await h.db.membership.update({ where: { id: pm.id }, data: { role: 'project_manager' } });
    assert.equal(await h.db.deliverable.count(), before, 'nothing released');
    assert.match((await h.db.reportSchedule.findUniqueOrThrow({ where: { id: s.id } })).lastResult ?? '', /^Not delivered: .*can no longer release/);
  });
});

/**
 * Development seed. Loads the labelled demo records from @sampledge/core into Postgres.
 * Every record is fictional. Wipes all tables first, so it refuses to run in production.
 *
 *   npm run db:seed -w @sampledge/api
 */
import 'dotenv/config';
import { Prisma, PrismaClient, type Role } from '@prisma/client';
import { access, brandSurvey, cloudSurvey, cxResponses, cxSurvey, rng, roles, seed, type ModuleId } from '@sampledge/core';
import bcrypt from 'bcryptjs';

export const DEMO_PASSWORD = 'demo1234';
export const MAIN_TENANT = 'sampledge-demo';
export const ISOLATION_TENANT = 'isolation-test';
export const demoEmail = (role: string) => `${role.replace(/_/g, '.')}@demo.sampledge.test`;

const day = 86400_000;

export async function runSeed(db: PrismaClient, opts: { panelists?: number; cxResponses?: number } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const tenant = await db.tenant.create({ data: { name: 'Sampledge (Demo workspace)', slug: MAIN_TENANT } });
  const t = tenant.id;

  // Users: one per role. Vendor user belongs to Atlas Sample Co. (vd-01), client user to Northwind Brands (cl-01).
  for (const r of roles) {
    const name = r.persona.replace(/ \(Demo\).*/, '').replace(/ ·.*/, '');
    const u = await db.user.create({ data: { email: demoEmail(r.id), name: `${name} (Demo)`, passwordHash: hash } });
    await db.membership.create({ data: { tenantId: t, userId: u.id, role: r.id as Role, vendorId: r.id === 'vendor' ? 'vd-01' : null, clientId: r.id === 'client' ? 'cl-01' : null } });
  }
  // A second PM so separation-of-duties flows can be exercised by one person in the demo.
  const pm2 = await db.user.create({ data: { email: 'project.manager2@demo.sampledge.test', name: 'Daniel Moreau (Demo)', passwordHash: hash } });
  await db.membership.create({ data: { tenantId: t, userId: pm2.id, role: 'project_manager' } });

  await db.client.createMany({ data: seed.clients.map((c) => ({ id: c.id, tenantId: t, name: c.name, sector: c.sector })) });
  await db.vendor.createMany({
    data: seed.vendors.map((v) => ({
      id: v.id, tenantId: t, name: v.name, hq: v.hq, coverage: v.coverage, audiences: v.audiences, cpiB2C: v.cpiB2C, cpiB2B: v.cpiB2B, cpiHC: v.cpiHC,
      quality: v.quality, reliability: v.reliability, responseRate: v.responseRate, speed: v.speed, delivered: v.delivered, pendingPayment: v.pendingPayment,
      bidWinRate: v.bidWinRate, verified: v.verified,
    })),
  });

  for (const p of seed.projects) {
    await db.project.create({
      data: {
        id: p.id, tenantId: t, code: p.code, name: p.name, clientId: p.clientId, audience: p.type, countries: p.countries, stage: p.stage, owner: p.owner,
        start: new Date(p.start), deadline: new Date(p.deadline), target: p.target, completes: p.completes, ir: p.ir, loi: p.loi, dropout: p.dropout,
        quality: p.quality, cpiSell: p.cpiSell, cpiCost: p.cpiCost, budget: p.budget, costIncurred: p.costIncurred, blockers: p.blockers,
      },
    });
    // Project-level quota cells (no survey definition): counts are the seeded demo values.
    if (p.id !== 'pr-002') {
      await db.quotaCell.createMany({ data: p.quotas.map((q) => ({ tenantId: t, projectId: p.id, key: `${p.id}-${q.id}`, label: q.label, target: q.target, count: q.achieved })) });
    }
    const share = Math.max(1, p.vendors.length);
    await db.allocation.createMany({
      data: p.vendors.map((vid) => ({
        tenantId: t, projectId: p.id, vendorId: vid, completes: Math.round(p.target / share), cpi: +(p.cpiCost * 0.98).toFixed(2),
        status: p.completes >= p.target ? 'closed' : p.completes > 0 ? 'live' : 'approved',
      })),
    });
  }

  for (const o of seed.opportunities) {
    await db.opportunity.create({
      data: {
        id: o.id, tenantId: t, clientId: o.clientId, title: o.title, stage: o.stage, owner: o.owner, audience: o.type, countries: o.countries,
        sampleSize: o.sampleSize, incidence: o.ir, loi: o.loi, value: o.value, margin: o.margin, probability: o.probability, lossReason: o.lossReason ?? null,
        createdAt: new Date(o.created), lastTouch: new Date(o.lastTouch),
      },
    });
  }

  // Finance records for work already in field or closed (demo): a PO and payable for each purchased
  // allocation, a draft invoice for the project at the Invoice stage and a paid one for the closed project.
  const purchased = await db.allocation.findMany({ where: { tenantId: t, status: { in: ['live', 'closed'] } }, include: { project: true }, orderBy: [{ projectId: 'asc' }, { vendorId: 'asc' }] });
  for (const [i, a] of purchased.entries()) {
    const amount = Math.round(a.completes * a.cpi);
    const issuedAt = new Date(a.project.start);
    const po = await db.purchaseOrder.create({ data: { tenantId: t, number: `PO-26${String(i + 1).padStart(4, '0')}`, vendorId: a.vendorId, projectId: a.projectId, allocationId: a.id, completes: a.completes, cpi: a.cpi, amount, status: 'issued', issuedAt } });
    const closed = a.status === 'closed';
    await db.payable.create({ data: { tenantId: t, vendorId: a.vendorId, purchaseOrderId: po.id, amount, status: closed ? 'paid' : 'open', dueAt: new Date(issuedAt.getTime() + 30 * day), paidAt: closed ? new Date(issuedAt.getTime() + 28 * day) : null } });
    await db.message.create({ data: { tenantId: t, channel: 'email', audience: 'vendor', toRef: `vendor:${a.vendorId}`, recipients: 1, subject: `Purchase order ${po.number}`, body: `${a.completes} completes at $${a.cpi.toFixed(2)} CPI for project ${a.project.code}. Total $${amount.toLocaleString('en-US')}.`, status: 'delivered_dev', adapter: 'development (recorded, not sent)', relatedType: 'PurchaseOrder', relatedId: po.id, createdBy: 'system', createdAt: issuedAt, deliveredAt: issuedAt } });
  }
  let invN = 0;
  for (const [pid, status] of [['pr-020', 'draft'], ['pr-024', 'paid']] as const) {
    const p = seed.projects.find((x) => x.id === pid)!;
    const issuedAt = status === 'paid' ? new Date(seed.DEMO_NOW.getTime() - 40 * day) : null;
    await db.invoice.create({ data: { tenantId: t, number: `INV-26${String(++invN).padStart(4, '0')}`, clientId: p.clientId, projectId: p.id, completes: p.completes, cpi: p.cpiSell, amount: Math.round(p.completes * p.cpiSell), status, issuedAt, dueAt: issuedAt && new Date(issuedAt.getTime() + 30 * day), paidAt: status === 'paid' ? new Date(seed.DEMO_NOW.getTime() - 12 * day) : null } });
  }

  // Open feasibility requests (sent, unanswered) so the vendor portal has a brief to answer.
  // No supplier answers are seeded: a response is a supplier confirmation and only a vendor gives one.
  const op10 = seed.opportunities.find((o) => o.id === 'op-010')!;
  for (const country of op10.countries) {
    await db.feasibilityRequest.create({ data: { tenantId: t, opportunityId: op10.id, vendorId: 'vd-01', country, audience: op10.type, sampleSize: op10.sampleSize, incidence: op10.ir, loi: op10.loi, status: 'sent', dueAt: new Date(seed.DEMO_NOW.getTime() + 3 * day) } });
  }

  for (const s of seed.surveys) {
    const isCloud = s.id === cloudSurvey.id;
    const isCx = s.id === cxSurvey.id;
    const isBrand = s.id === brandSurvey.id;
    await db.survey.create({
      data: {
        id: s.id, tenantId: t, projectId: s.projectId, name: s.name, status: s.status, programmer: s.programmer, currentVersion: isCloud ? cloudSurvey.version : 1,
        hoursSpent: s.hoursSpent, complexity: s.complexity, completionRate: s.completionRate, loi: s.loi, languages: s.languages, alerts: s.alerts, hasDefinition: isCloud || isCx || isBrand, questionCount: isCloud ? cloudSurvey.questions.length : isCx ? cxSurvey.questions.length : isBrand ? brandSurvey.questions.length : s.questions,
      },
    });
  }
  // The programmed survey: earlier versions are recorded as history, the current one holds the definition.
  const cloudDef = { ...cloudSurvey, quotas: cloudSurvey.quotas.map((q) => ({ ...q, count: 0 })) };
  for (let v = 1; v <= cloudSurvey.version; v++) {
    await db.surveyVersion.create({
      data: { surveyId: cloudSurvey.id, version: v, label: v === cloudSurvey.version ? 'Imported screener + core (demo)' : `Draft ${v} (demo history)`, createdBy: 'Jonas Weber (Demo)', definition: cloudDef as unknown as Prisma.InputJsonValue, createdAt: new Date(seed.DEMO_NOW.getTime() - (cloudSurvey.version - v) * 2 * day) },
    });
  }
  // A closed survey with SYNTHETIC completed interviews (generated, not real people) so Data
  // Processing and Insight Studio have a full dataset to weight, code and tabulate.
  await db.surveyVersion.create({ data: { surveyId: cxSurvey.id, version: 1, label: 'Fielded version (demo)', createdBy: 'Mei Lin (Demo)', definition: cxSurvey as unknown as Prisma.InputJsonValue, publishedAt: new Date(seed.DEMO_NOW.getTime() - 40 * day) } });
  // A live (Published) survey so the public respondent link works in the demo without signing in.
  await db.surveyVersion.create({ data: { surveyId: brandSurvey.id, version: 1, label: 'Fielded version (demo)', createdBy: 'Jonas Weber (Demo)', definition: brandSurvey as unknown as Prisma.InputJsonValue, publishedAt: new Date(seed.DEMO_NOW.getTime() - 6 * day) } });
  const cxStart = seed.DEMO_NOW.getTime() - 38 * day;
  await db.response.createMany({
    data: cxResponses(opts.cxResponses ?? 600).map((x, i) => {
      const started = new Date(cxStart + i * 50 * 60_000);
      return { tenantId: t, surveyId: cxSurvey.id, version: 1, source: 'synthetic:demo', respondent: x.respondent, answers: x.answers as Prisma.InputJsonValue, path: cxSurvey.questions.map((q) => q.id), outcome: 'complete', startedAt: started, completedAt: new Date(started.getTime() + x.minutes * 60_000) };
    }),
  });

  await db.quotaCell.createMany({
    data: cloudSurvey.quotas.map((q) => ({ tenantId: t, projectId: 'pr-002', surveyId: cloudSurvey.id, key: q.id, label: q.label, condition: q.when as Prisma.InputJsonValue, target: q.target, count: q.count })),
  });

  await db.agent.createMany({
    data: seed.agents.map((a) => ({ id: a.id, tenantId: t, name: a.name, enabled: a.enabled, runs30d: a.runs30d, successRate: a.successRate, avgSeconds: a.avgSeconds, minutesSaved: a.minutesSaved, costUsd30d: a.costUsd30d, costCapUsd: a.costCapUsd, requiresApproval: a.requiresApprovalFor })),
  });
  await db.approval.createMany({
    data: seed.approvals.map((a) => ({ id: a.id, tenantId: t, agentId: a.agentId, kind: a.kind, title: `${a.title} (demo)`, projectId: a.projectId ?? null, amount: a.amount ?? null, requestedBy: `agent:${a.agentId}`, createdAt: new Date(a.requested), payload: { demo: true } })),
  });
  const minutes: Record<string, number> = { '8m': 8, '21m': 21, '46m': 46, '1h': 60, '3h': 180 };
  const notes = await db.notification.createManyAndReturn({
    data: seed.notificationsSeed.map((n) => ({
      tenantId: t, title: n.title, body: n.body, module: n.module, createdAt: new Date(seed.DEMO_NOW.getTime() - (minutes[n.time] ?? 0) * 60_000),
      roles: roles.filter((r) => access(r.id, n.module as ModuleId) !== 'none').map((r) => r.id as Role),
    })),
  });
  // Read state is per person: the seed's already-read notifications start read for everyone who sees them.
  const members = await db.membership.findMany({ where: { tenantId: t } });
  await db.notificationRead.createMany({
    data: notes.flatMap((n, i) => (seed.notificationsSeed[i].read ? members.filter((m) => !n.roles.length || n.roles.includes(m.role)).map((m) => ({ tenantId: t, notificationId: n.id, userId: m.userId })) : [])),
  });

  await db.messageTemplate.createMany({
    data: [
      { tenantId: t, key: 'panel_invite', name: 'Survey invitation', channel: 'email', subject: 'New survey for you: about {{loi}} minutes', body: 'Hi {{handle}}, a new survey matches your profile. It takes about {{loi}} minutes and earns {{points}} points. Take part: {{link}}' },
      { tenantId: t, key: 'panel_reengage', name: 'Re-engagement', channel: 'email', subject: 'We miss your opinions', body: 'Hi {{handle}}, new surveys are waiting and your {{points}} points are still here. Update your profile to get better matches.' },
      { tenantId: t, key: 'client_fieldwork_update', name: 'Client fieldwork update', channel: 'email', subject: '{{project}}: fieldwork update', body: 'Fieldwork is at {{completes}} of {{target}} completes. Incidence is tracking at {{ir}}. Next update tomorrow.' },
      { tenantId: t, key: 'vendor_top_up', name: 'Vendor top-up request', channel: 'email', subject: 'Top-up request for {{project}}', body: 'Could you deliver {{n}} more completes for {{project}} by {{date}} at the agreed CPI? Please confirm in the vendor portal.' },
    ],
  });

  // Synthetic, pseudonymous panelists. No names, contact details or health records.
  const r = rng(77);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const brands = [
    { id: 'turn2opinion', w: 0.55, segs: ['consumer'] },
    { id: 'myfrequentrewards', w: 0.33, segs: ['consumer', 'professional'] },
    { id: 'myhealthopinions', w: 0.12, segs: ['hcp', 'patient', 'caregiver'] },
  ];
  const n = opts.panelists ?? 3000;
  const rows: Prisma.PanelistCreateManyInput[] = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    const b = x < brands[0].w ? brands[0] : x < brands[0].w + brands[1].w ? brands[1] : brands[2];
    const st = r();
    rows.push({
      id: `pn-${String(i + 1).padStart(5, '0')}`, tenantId: t, brand: b.id, handle: `${b.id.slice(0, 3).toUpperCase()}-${(100000 + Math.floor(r() * 899999)).toString(36).toUpperCase()}`,
      country: pick(seed.countries).code, ageBand: pick(['18-24', '25-34', '35-44', '45-54', '55-64', '65+']), gender: pick(['female', 'male', 'nonbinary', 'undisclosed']),
      segment: pick(b.segs), status: st < 0.62 ? 'active' : st < 0.95 ? 'dormant' : 'suspended', qualityScore: +(0.6 + r() * 0.39).toFixed(3),
      points: Math.floor(r() * 9000), profileCompletion: +(0.3 + r() * 0.7).toFixed(2), surveysCompleted: Math.floor(r() * 80),
      joinedAt: new Date(seed.DEMO_NOW.getTime() - Math.floor(r() * 900) * day), lastActiveAt: new Date(seed.DEMO_NOW.getTime() - Math.floor(r() * 120) * day),
    });
  }
  await db.panelist.createMany({ data: rows });
  await db.consent.createMany({
    data: rows.flatMap((p) => [
      { panelistId: p.id!, purpose: 'research_participation', granted: true, at: p.joinedAt as Date },
      ...(p.brand === 'myhealthopinions' ? [{ panelistId: p.id!, purpose: 'health_data', granted: true, at: p.joinedAt as Date }] : []),
    ]),
  });

  // Isolation tenant: a second workspace whose records must never appear in the first.
  const other = await db.tenant.create({ data: { name: 'Isolation Test Co (Demo)', slug: ISOLATION_TENANT } });
  const oa = await db.user.create({ data: { email: 'admin@isolation.sampledge.test', name: 'Isolation Admin (Demo)', passwordHash: hash } });
  await db.membership.create({ data: { tenantId: other.id, userId: oa.id, role: 'platform_admin' } });
  const oc = await db.client.create({ data: { tenantId: other.id, name: 'Other Tenant Client' } });
  await db.project.create({
    data: { tenantId: other.id, code: 'SE-26100', name: 'Other tenant private project', clientId: oc.id, audience: 'B2C', countries: ['US'], stage: 'Fieldwork Monitoring', owner: 'Isolation Admin', start: seed.DEMO_NOW, deadline: new Date(seed.DEMO_NOW.getTime() + 10 * day), target: 100, ir: 0.5, loi: 10, cpiSell: 5, cpiCost: 3, budget: 330, blockers: [] },
  });
  await db.vendor.create({ data: { tenantId: other.id, name: 'Other Tenant Vendor', hq: 'US', coverage: ['US'], audiences: ['B2C'], cpiB2C: 2, cpiB2B: 10, cpiHC: 40, quality: 0.9, reliability: 0.9, responseRate: 0.1, speed: 0.8 } });

  return { tenant: tenant.slug, users: roles.length + 2, projects: seed.projects.length, panelists: n };
}

if (require.main === module) {
  const db = new PrismaClient();
  runSeed(db)
    .then((r) => {
      console.log('Seeded (demo data):', r);
      console.log(`Demo sign-in: <role>@demo.sampledge.test / ${DEMO_PASSWORD}  e.g. ${demoEmail('executive')}`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}

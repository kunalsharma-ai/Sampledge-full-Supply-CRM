import { documentCurrency, invoiceTerms, toDoc } from './finance-ledgers';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { live } from '../common/live';
import { can, type Role } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { approvalKinds, fallbackDeciders, type ApprovalKind } from '../common/approvals';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { asTenant } from '../common/tenant-scope';
import { PanelBackend, PanelBackendError, PANELS, type PanelId } from '../integrations/panel-backend';
import { PanelSyncService } from '../integrations/panel-sync.service';

type Tx = Prisma.TransactionClient;
type Ev = { id: string; tenantId: string; type: string; payload: Record<string, string | number>; createdAt: Date };

const INTERNAL: Role[] = ['platform_admin', 'executive', 'project_manager', 'survey_programmer', 'bizdev', 'data_processing', 'finance', 'panel_manager'];
const day = 86400_000;

/** Internal roles that may decide an approval kind (external roles get targeted messages instead). */
function decidersOf(kind: string): Role[] {
  const perm = approvalKinds[kind as ApprovalKind];
  return INTERNAL.filter((r) => (perm ? can(r, perm) : fallbackDeciders.includes(r)));
}

async function nextNumber(tx: Tx, tenantId: string, kind: 'PO' | 'INV') {
  const n = kind === 'PO' ? await tx.purchaseOrder.count({ where: { tenantId } }) : await tx.invoice.count({ where: { tenantId } });
  return `${kind}-26${String(n + 1).padStart(4, '0')}`;
}

// Delivery lives in ./delivery; re-exported here because callers import it from the worker.
import { deliveryAdapter } from './delivery';
import { applyRetention, logRun } from './retention';
export { deliveryAdapter };

/**
 * Outbox worker. Claims a batch with a 30 s lease (FOR UPDATE SKIP LOCKED, so several workers can
 * run), handles each event in its own transaction and marks it processed there. Failures are
 * retried up to 5 times with the error kept on the row. Handlers are idempotent.
 * Runs inside the API by default; set WORKER_INLINE=false and run dist/worker.js separately to split it out.
 */
@Injectable()
export class EventsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private log = new Logger('EventsWorker');
  constructor(private db: PrismaService, private panels: PanelBackend, private panelSync: PanelSyncService) {}

  onApplicationBootstrap() {
    if (process.env.WORKER_INLINE === 'false') return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e)), Number(process.env.WORKER_POLL_MS ?? 1000));
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processes everything pending (used by tests and the standalone worker's shutdown). */
  async drain() {
    for (let i = 0; i < 50; i++) if ((await this.tick()) === 0) return;
  }

  private lastSweep = 0;
  private lastImport = 0;
  /** Housekeeping once an hour: expired idempotency keys, finished rate-limit windows, expired SAML keys. */
  async sweep() {
    this.lastSweep = Date.now();
    const keys = await this.db.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
    if (keys.count) this.log.log(`swept ${keys.count} expired idempotency keys`);
    const buckets = await this.db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 3600_000) }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] } });
    if (buckets.count) this.log.log(`swept ${buckets.count} old rate-limit windows`);
    await this.db.samlCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    // A panel call still "sending" after 10 minutes was interrupted mid-request: a person checks
    // the panel before anything is sent again.
    const stuck = await this.db.panelCall.updateMany({ where: { status: 'sending', createdAt: { lt: new Date(Date.now() - 600_000) } }, data: { status: 'needs_review', error: 'Interrupted while sending; check the panel before retrying' } });
    if (stuck.count) this.log.warn(`${stuck.count} panel call(s) need review`);
    await this.retention();
  }

  /** Applies each workspace's retention policies, at most once a day per workspace. */
  async retention() {
    const due = await this.db.tenant.findMany({ where: { NOT: { retention: { equals: {} } }, OR: [{ retentionRunAt: null }, { retentionRunAt: { lt: new Date(Date.now() - 24 * 3600_000) } }] }, select: { id: true } });
    for (const t of due) {
      await asTenant(t.id, () => this.db.$transaction(async (tx) => {
        const counts = await applyRetention(tx, t.id);
        await logRun(tx, t.id, { userId: null, name: 'system (daily retention)' }, counts as Record<string, number>);
        const n = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
        if (n) this.log.log(`retention: ${n} record(s) removed or redacted in ${t.id}`);
      })).catch((e) => this.log.error(e));
    }
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    if (Date.now() - this.lastSweep > 3600_000) await this.sweep().catch((e) => this.log.error(e));
    // Response import from the panels for synced projects, every PANEL_IMPORT_INTERVAL_MS (off when 0).
    const every = Number(process.env.PANEL_IMPORT_INTERVAL_MS ?? 0);
    if (every > 0 && Date.now() - this.lastImport > every) {
      this.lastImport = Date.now();
      void this.panelSync.importAll().then((r) => r.received && this.log.log(`imported ${r.received} panel response(s)`)).catch((e) => this.log.error(e));
    }
    this.running = true;
    try {
      const batch = await this.db.$queryRaw<Ev[]>`
        UPDATE "OutboxEvent" SET "lockedUntil" = now() + interval '30 seconds', "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "OutboxEvent"
          WHERE "processedAt" IS NULL AND "attempts" < 5 AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
          ORDER BY "createdAt" LIMIT 25 FOR UPDATE SKIP LOCKED)
        RETURNING "id", "tenantId", "type", "payload", "createdAt"`;
      batch.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const ev of batch) {
        try {
          // Each event is handled as its tenant, so the database refuses rows from any other workspace.
          await asTenant(ev.tenantId, () => this.db.$transaction(async (tx) => {
            await this.handle(tx, ev);
            await tx.outboxEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), lastError: null } });
            await live(tx, { t: ev.tenantId, type: ev.type });
          }));
        } catch (e) {
          this.log.warn(`event ${ev.type} ${ev.id} failed: ${(e as Error).message}`);
          await this.db.outboxEvent.update({ where: { id: ev.id }, data: { lastError: String((e as Error).message).slice(0, 500), lockedUntil: null } });
        }
      }
      return batch.length;
    } finally {
      this.running = false;
    }
  }

  private async notify(tx: Tx, tenantId: string, roles: Role[], title: string, body: string, module: string) {
    const n = await tx.notification.create({ data: { tenantId, roles, title, body, module } });
    await live(tx, { t: tenantId, type: 'notification', module, roles, title });
    return n;
  }

  private async queueMessage(tx: Tx, tenantId: string, m: { channel: string; audience: string; toRef: string; subject: string; body: string; relatedType: string; relatedId: string }) {
    const exists = await tx.message.findFirst({ where: { tenantId, relatedType: m.relatedType, relatedId: m.relatedId, toRef: m.toRef } });
    if (exists) return exists;
    const msg = await tx.message.create({ data: { tenantId, ...m, recipients: 1, status: 'queued', createdBy: 'system' } });
    await emit(tx, tenantId, 'message.queued', { messageId: msg.id });
    return msg;
  }

  private async handle(tx: Tx, ev: Ev) {
    const p = ev.payload;
    const t = ev.tenantId;
    switch (ev.type) {
      case 'opportunity.won': {
        const o = await tx.opportunity.findUnique({ where: { id: String(p.opportunityId) }, include: { project: true } });
        if (o?.project) await this.notify(tx, t, ['project_manager', 'platform_admin', 'executive', 'bizdev'], `Project ${o.project.code} created`, `${o.title} won; ready for setup`, 'projects');
        return;
      }
      case 'approval.requested': {
        const a = await tx.approval.findUnique({ where: { id: String(p.approvalId) } });
        if (a) await this.notify(tx, t, decidersOf(a.kind), `Approval needed: ${a.kind}`, a.title, 'automation');
        return;
      }
      case 'approval.decided': {
        const a = await tx.approval.findUnique({ where: { id: String(p.approvalId) } });
        if (!a) return;
        const m = a.requestedBy.startsWith('agent:') ? null : await tx.membership.findFirst({ where: { tenantId: t, userId: a.requestedBy } });
        const to = m && INTERNAL.includes(m.role) ? [m.role] : ['platform_admin' as Role];
        await this.notify(tx, t, to, `${a.kind} ${a.status}`, `${a.title}${a.decidedBy ? ` · by ${a.decidedBy}` : ''}`, 'automation');
        return;
      }
      case 'allocation.approved': {
        const al = await tx.allocation.findUnique({ where: { id: String(p.allocationId) }, include: { project: true, vendor: true } });
        if (!al) return;
        const existing = await tx.purchaseOrder.findUnique({ where: { allocationId: al.id } });
        if (existing) return;
        // Allocation CPIs are in the base currency; the PO is raised in the vendor's currency at the recorded rate.
        const fx = await documentCurrency(tx, t, al.vendor.currency);
        const cpi = Math.round(toDoc(al.cpi, fx.fxRate) * 100) / 100;
        const amount = Math.round(al.completes * cpi);
        const po = await tx.purchaseOrder.create({ data: { tenantId: t, number: await nextNumber(tx, t, 'PO'), vendorId: al.vendorId, projectId: al.projectId, allocationId: al.id, completes: al.completes, cpi, amount, currency: fx.currency, fxRate: fx.fxRate, status: 'issued' } });
        await tx.payable.create({ data: { tenantId: t, vendorId: al.vendorId, purchaseOrderId: po.id, amount, currency: fx.currency, status: 'open', dueAt: new Date(Date.now() + 30 * day) } });
        await tx.vendor.update({ where: { id: al.vendorId }, data: { pendingPayment: { increment: Math.round(amount * fx.fxRate) } } });
        const money = (n: number, d = 0) => `${fx.currency} ${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'vendor', toRef: `vendor:${al.vendorId}`, relatedType: 'PurchaseOrder', relatedId: po.id,
          subject: `Purchase order ${po.number}`, body: `${al.vendor.name}: ${al.completes} completes at ${money(cpi, 2)} CPI for project ${al.project.code}. Total ${money(amount)}.`,
        });
        await this.notify(tx, t, ['finance', 'project_manager'], `PO ${po.number} issued`, `${al.vendor.name} · ${al.project.code} · ${money(amount)}`, 'finance');
        return;
      }
      case 'quote.sent': {
        const q = await tx.quote.findUnique({ where: { id: String(p.quoteId) }, include: { opportunity: { include: { client: true } } } });
        if (!q) return;
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'client', toRef: `client:${q.opportunity.clientId}`, relatedType: 'Quote', relatedId: q.id,
          subject: `Quotation: ${q.opportunity.title} (v${q.version})`,
          body: `${q.opportunity.sampleSize} completes, ${q.opportunity.countries.join(', ')}, ${q.opportunity.loi} min LOI. CPI $${q.cpiSell.toFixed(2)}, total $${q.total.toLocaleString('en-US')}. Basis: ${q.basis.replace(/_/g, ' ')}.`,
        });
        return;
      }
      case 'survey.published': {
        const s = await tx.survey.findUnique({ where: { id: String(p.surveyId) } });
        if (s) await this.notify(tx, t, ['project_manager', 'survey_programmer', 'platform_admin'], `${s.name} is live`, `v${p.version} published; respondent links accept traffic`, 'survey-studio');
        return;
      }
      case 'project.stage_changed': {
        if (p.to !== 'Invoice') return;
        const pr = await tx.project.findUnique({ where: { id: String(p.projectId) } });
        if (!pr || (await tx.invoice.findFirst({ where: { projectId: pr.id, status: { not: 'void' } } }))) return;
        const inv = await tx.invoice.create({ data: { tenantId: t, number: await nextNumber(tx, t, 'INV'), ...(await invoiceTerms(tx, t, pr)), status: 'draft' } });
        await this.notify(tx, t, ['finance', 'executive'], `Invoice ${inv.number} drafted`, `${pr.code} ${pr.name}: ${pr.completes} completes · ${inv.currency} ${inv.amount.toLocaleString('en-US')}`, 'finance');
        return;
      }
      case 'deliverable.released': {
        // Tell the client a file is ready; the message itself carries no data, only where to find it.
        const d = await tx.deliverable.findUnique({ where: { id: String(p.deliverableId) }, select: { id: true, title: true, status: true, project: { select: { code: true, name: true, clientId: true } } } });
        if (!d || d.status !== 'released' || !d.project.clientId) return;
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'client', toRef: `client:${d.project.clientId}`, relatedType: 'Deliverable', relatedId: d.id,
          subject: `New deliverable: ${d.title}`,
          body: `${d.project.code} ${d.project.name}: "${d.title}" is ready to download in your client portal.`,
        });
        return;
      }
      case 'quota.filled': {
        await this.notify(tx, t, ['project_manager', 'survey_programmer'], `Quota "${p.label}" is full`, 'Further matching respondents are terminated as overquota', 'projects');
        return;
      }
      case 'feasibility.requested': {
        const f = await tx.feasibilityRequest.findUnique({ where: { id: String(p.requestId) } });
        if (!f) return;
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'vendor', toRef: `vendor:${f.vendorId}`, relatedType: 'FeasibilityRequest', relatedId: f.id,
          subject: `Feasibility request: ${f.audience} ${f.country}, n=${f.sampleSize}`,
          body: `IR ${(f.incidence * 100).toFixed(0)}%, LOI ${f.loi} min. Please reply with CPI and capacity by ${f.dueAt.toISOString().slice(0, 10)} in the vendor portal.`,
        });
        return;
      }
      case 'diy.requested': {
        const o = await tx.opportunity.findUnique({ where: { id: String(p.opportunityId) }, include: { client: true } });
        if (o) await this.notify(tx, t, ['bizdev', 'executive'], `DIY request from ${o.client.name}`, `${o.title}: ${o.audience} · ${o.countries.join(', ')} · n=${o.sampleSize}`, 'crm');
        return;
      }
      case 'feasibility.responded': {
        const f = await tx.feasibilityRequest.findUnique({ where: { id: String(p.requestId) } });
        const v = f ? await tx.vendor.findUnique({ where: { id: f.vendorId } }) : null;
        if (f && v) await this.notify(tx, t, ['bizdev', 'project_manager'], `${v.name} ${f.status === 'declined' ? 'declined' : 'responded'}`, `${f.audience} ${f.country}${f.cpi ? ` · CPI $${f.cpi.toFixed(2)} · capacity ${f.capacity}` : ''}`, 'crm');
        return;
      }
      case 'invoice.issued': {
        const inv = await tx.invoice.findUnique({ where: { id: String(p.invoiceId) } });
        if (!inv) return;
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'client', toRef: `client:${inv.clientId}`, relatedType: 'Invoice', relatedId: inv.id,
          subject: `Invoice ${inv.number}`, body: `${inv.completes} completes at $${inv.cpi.toFixed(2)}. Amount due $${inv.amount.toLocaleString('en-US')} by ${inv.dueAt?.toISOString().slice(0, 10)}.`,
        });
        return;
      }
      case 'payable.paid': {
        const pay = await tx.payable.findUnique({ where: { id: String(p.payableId) }, include: { purchaseOrder: true } });
        if (!pay) return;
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'vendor', toRef: `vendor:${pay.vendorId}`, relatedType: 'Payable', relatedId: pay.id,
          subject: `Payment recorded for ${pay.purchaseOrder.number}`, body: `$${pay.amount.toLocaleString('en-US')} marked paid. Payment rails are not connected; this is a record, not a transfer.`,
        });
        return;
      }
      case 'panel.call.approved': {
        // At most once: claim the call outside this transaction, so a retry after a crash finds it
        // already claimed and leaves it for a person (needs_review) instead of sending it again.
        const claimed = await this.db.panelCall.updateMany({ where: { id: String(p.callId), status: 'queued' }, data: { status: 'sending' } });
        if (!claimed.count) return;
        const c = await tx.panelCall.findUniqueOrThrow({ where: { id: String(p.callId) } });
        const name = PANELS[c.panel as PanelId] ?? c.panel;
        let result: { status: string; httpStatus?: number; response?: Prisma.InputJsonValue; error?: string };
        try {
          const r = await this.panels.call(c.panel as PanelId, c.method, c.path, c.method === 'DELETE' ? undefined : (c.body ?? {}));
          result = { status: 'sent', httpStatus: r.status, response: { message: r.message, data: r.data } as Prisma.InputJsonValue };
        } catch (e) {
          const err = e as PanelBackendError;
          result = err.status === 503 ? { status: 'not_sent', error: err.message } : { status: 'failed', httpStatus: err.status, error: String(err.message).slice(0, 500) };
        }
        await tx.panelCall.update({ where: { id: c.id }, data: { ...result, completedAt: new Date() } });
        const what = `${c.action} on ${name}`;
        await this.notify(tx, t, ['panel_manager', 'platform_admin'], result.status === 'sent' ? `Panel ${what}: sent` : `Panel ${what}: ${result.status.replace('_', ' ')}`, result.status === 'sent' ? `${name} accepted the request.` : result.error ?? 'See the panel call log.', 'panels');
        return;
      }
      case 'message.queued': {
        const m = await tx.message.findUnique({ where: { id: String(p.messageId) } });
        if (m && m.status === 'queued') await deliveryAdapter.deliver(tx, m.id);
        return;
      }
      default:
        throw new Error(`No handler for ${ev.type}`);
    }
  }
}

export const internalRoles = INTERNAL;

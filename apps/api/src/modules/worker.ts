import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { can, type Role } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { approvalKinds, fallbackDeciders, type ApprovalKind } from '../common/approvals';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';

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

/**
 * Delivery adapter. The only adapter today is the development adapter: it records the message as
 * delivered inside the system and sends nothing externally. An SMTP/SMS provider adapter plugs in
 * here behind the same interface (COMMS_ADAPTER), without changing callers.
 */
export const deliveryAdapter = {
  name: 'development (recorded, not sent)',
  async deliver(tx: Tx, messageId: string) {
    await tx.message.update({ where: { id: messageId }, data: { status: 'delivered_dev', adapter: this.name, deliveredAt: new Date() } });
  },
};

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
  constructor(private db: PrismaService) {}

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

  async tick(): Promise<number> {
    if (this.running) return 0;
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
          await this.db.$transaction(async (tx) => {
            await this.handle(tx, ev);
            await tx.outboxEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), lastError: null } });
          });
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

  private notify(tx: Tx, tenantId: string, roles: Role[], title: string, body: string, module: string) {
    return tx.notification.create({ data: { tenantId, roles, title, body, module } });
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
        const amount = Math.round(al.completes * al.cpi);
        const po = await tx.purchaseOrder.create({ data: { tenantId: t, number: await nextNumber(tx, t, 'PO'), vendorId: al.vendorId, projectId: al.projectId, allocationId: al.id, completes: al.completes, cpi: al.cpi, amount, status: 'issued' } });
        await tx.payable.create({ data: { tenantId: t, vendorId: al.vendorId, purchaseOrderId: po.id, amount, status: 'open', dueAt: new Date(Date.now() + 30 * day) } });
        await tx.vendor.update({ where: { id: al.vendorId }, data: { pendingPayment: { increment: amount } } });
        await this.queueMessage(tx, t, {
          channel: 'email', audience: 'vendor', toRef: `vendor:${al.vendorId}`, relatedType: 'PurchaseOrder', relatedId: po.id,
          subject: `Purchase order ${po.number}`, body: `${al.vendor.name}: ${al.completes} completes at $${al.cpi.toFixed(2)} CPI for project ${al.project.code}. Total $${amount.toLocaleString('en-US')}.`,
        });
        await this.notify(tx, t, ['finance', 'project_manager'], `PO ${po.number} issued`, `${al.vendor.name} · ${al.project.code} · $${amount.toLocaleString('en-US')}`, 'finance');
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
        const inv = await tx.invoice.create({ data: { tenantId: t, number: await nextNumber(tx, t, 'INV'), clientId: pr.clientId, projectId: pr.id, completes: pr.completes, cpi: pr.cpiSell, amount: Math.round(pr.completes * pr.cpiSell), status: 'draft' } });
        await this.notify(tx, t, ['finance', 'executive'], `Invoice ${inv.number} drafted`, `${pr.code} ${pr.name}: ${pr.completes} completes · $${inv.amount.toLocaleString('en-US')}`, 'finance');
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

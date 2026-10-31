import type { Response } from 'express';
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { can } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { DEFAULT_PAGE, pageArgs, paged, type Page } from '../common/paging';
import { emit } from '../common/events';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

const day = 86400_000;

/**
 * Finance: client invoices (accounts receivable), purchase orders and vendor payables (accounts
 * payable). POs and payables are raised by the worker when a sample purchase is approved; draft
 * invoices when a project reaches the Invoice stage. Paying a vendor requires an approval.
 * No payment rail or accounting system is connected: "paid" is a record, not a transfer.
 */
@Injectable()
export class FinanceService {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private clientScope(ctx: Ctx): Prisma.InvoiceWhereInput {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'client' ? { clientId: ctx.clientId ?? '__none__', status: { not: 'draft' } } : {}) };
  }
  private vendorScope(ctx: Ctx) {
    return { tenantId: ctx.tenantId, ...(ctx.role === 'vendor' ? { vendorId: ctx.vendorId ?? '__none__' } : {}) };
  }

  async summary(ctx: Ctx) {
    const [inv, pay, pos] = await Promise.all([
      ctx.role === 'vendor' ? [] : this.db.invoice.findMany({ where: this.clientScope(ctx) }),
      ctx.role === 'client' ? [] : this.db.payable.findMany({ where: this.vendorScope(ctx) }),
      ctx.role === 'client' ? 0 : this.db.purchaseOrder.count({ where: this.vendorScope(ctx) }),
    ]);
    const sumBy = <T extends { amount: number; status: string }>(rows: T[], st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.amount, 0);
    const now = new Date();
    return {
      receivable: sumBy(inv, ['issued']), overdueReceivable: inv.filter((i) => i.status === 'issued' && i.dueAt && i.dueAt < now).reduce((s, i) => s + i.amount, 0),
      collected: sumBy(inv, ['paid']), draftInvoices: inv.filter((i) => i.status === 'draft').length,
      payable: sumBy(pay, ['open', 'pending_approval']), paidOut: sumBy(pay, ['paid']), awaitingApproval: pay.filter((p) => p.status === 'pending_approval').length,
      purchaseOrders: pos,
      note: 'Records only. No accounting system or payment rail is connected.',
    };
  }

  async invoices(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.invoice.findMany({ where: this.clientScope(ctx), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page });
    const projects = new Map((await this.db.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const clients = new Map((await this.db.client.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return rows.map((r) => ({ ...r, project: projects.get(r.projectId), clientName: clients.get(r.clientId) }));
  }

  /** Draft an invoice from a project's delivered completes at the sell CPI. */
  async draftInvoice(ctx: Ctx, projectId: string) {
    const pr = await this.db.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId } });
    if (!pr) throw new NotFoundException('Project not found');
    if (pr.completes <= 0) throw new BadRequestException('No delivered completes to invoice');
    if (await this.db.invoice.findFirst({ where: { projectId, status: { not: 'void' } } })) throw new BadRequestException('This project already has an invoice');
    return this.db.$transaction(async (tx) => {
      const n = await tx.invoice.count({ where: { tenantId: ctx.tenantId } });
      const inv = await tx.invoice.create({ data: { tenantId: ctx.tenantId, number: `INV-26${String(n + 1).padStart(4, '0')}`, clientId: pr.clientId, projectId, completes: pr.completes, cpi: pr.cpiSell, amount: Math.round(pr.completes * pr.cpiSell), status: 'draft' } });
      await this.audit.log(ctx, 'invoice.draft', 'Invoice', inv.id, undefined, inv, tx);
      return inv;
    });
  }

  async issue(ctx: Ctx, id: string, termsDays: number) {
    const inv = await this.db.invoice.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'draft') throw new BadRequestException(`Invoice is ${inv.status}`);
    return this.db.$transaction(async (tx) => {
      const u = await tx.invoice.update({ where: { id }, data: { status: 'issued', issuedAt: new Date(), dueAt: new Date(Date.now() + termsDays * day) } });
      await emit(tx, ctx.tenantId, 'invoice.issued', { invoiceId: id });
      await this.audit.log(ctx, 'invoice.issue', 'Invoice', id, { status: 'draft' }, { status: 'issued', dueAt: u.dueAt }, tx);
      return u;
    });
  }

  async markReceived(ctx: Ctx, id: string) {
    const inv = await this.db.invoice.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'issued') throw new BadRequestException(`Invoice is ${inv.status}`);
    const u = await this.db.invoice.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } });
    await this.audit.log(ctx, 'invoice.paid', 'Invoice', id, { status: 'issued' }, { status: 'paid' });
    return u;
  }

  async purchaseOrders(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.purchaseOrder.findMany({ where: this.vendorScope(ctx), include: { payables: true }, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], ...page });
    const vendors = new Map((await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
    const projects = new Map((await this.db.project.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
    return rows.map((r) => ({ ...r, vendorName: vendors.get(r.vendorId), projectCode: projects.get(r.projectId) }));
  }

  async payables(ctx: Ctx, { want: _w, ...page }: Page = DEFAULT_PAGE) {
    const rows = await this.db.payable.findMany({ where: this.vendorScope(ctx), include: { purchaseOrder: { select: { number: true, projectId: true } } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], ...page });
    const vendors = new Map((await this.db.vendor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
    return rows.map((r) => ({ ...r, vendorName: vendors.get(r.vendorId) }));
  }

  /** Paying a vendor is approval-gated (Issuing payments → approve:payments, never the requester). */
  async requestPayment(ctx: Ctx, id: string) {
    const pay = await this.db.payable.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { purchaseOrder: true } });
    if (!pay) throw new NotFoundException('Payable not found');
    if (pay.status !== 'open') throw new BadRequestException(`Payable is ${pay.status}`);
    const v = await this.db.vendor.findUniqueOrThrow({ where: { id: pay.vendorId } });
    return this.db.$transaction(async (tx) => {
      await tx.payable.update({ where: { id }, data: { status: 'pending_approval' } });
      const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Issuing payments', title: `Pay ${v.name} for ${pay.purchaseOrder.number}`, amount: pay.amount, projectId: pay.purchaseOrder.projectId, requestedBy: ctx.userId, payload: { payableId: id } });
      await this.audit.log(ctx, 'payable.payment_requested', 'Payable', id, { status: 'open' }, { status: 'pending_approval', approvalId: ap.id }, tx);
      return { approval: ap };
    });
  }
}

@ForModule('finance')
@Controller()
export class FinanceController {
  constructor(private s: FinanceService) {}

  @Get('finance/summary') summary(@Caller() ctx: Ctx) { return this.s.summary(ctx); }
  @Get('invoices') async invoices(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return paged(await this.s.invoices(ctx, pg), pg.want, res); }
  @Get('purchase-orders') async pos(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return can(ctx.role, 'view:vendor_bids') || ctx.role === 'vendor' ? paged(await this.s.purchaseOrders(ctx, pg), pg.want, res) : []; }
  @Get('payables') async payables(@Caller() ctx: Ctx, @Query() q: unknown, @Res({ passthrough: true }) res: Response) { const pg = pageArgs(q, 500, 500); return can(ctx.role, 'view:vendor_bids') || ctx.role === 'vendor' ? paged(await this.s.payables(ctx, pg), pg.want, res) : []; }

  @Write() @Post('invoices')
  draft(@Caller() ctx: Ctx, @Body() b: unknown) { return this.s.draftInvoice(ctx, parse(z.object({ projectId: z.string() }), b).projectId); }

  @Write() @Post('invoices/:id/issue') @HttpCode(200)
  issue(@Caller() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.s.issue(ctx, id, parse(z.object({ termsDays: z.number().int().min(0).max(120).default(30) }), b ?? {}).termsDays); }

  @Write() @Post('invoices/:id/mark-paid') @HttpCode(200)
  paid(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.markReceived(ctx, id); }

  @Write() @Post('payables/:id/request-payment')
  pay(@Caller() ctx: Ctx, @Param('id') id: string) { return this.s.requestPayment(ctx, id); }
}

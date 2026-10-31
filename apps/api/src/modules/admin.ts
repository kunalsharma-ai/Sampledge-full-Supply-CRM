/**
 * Admin & Security: what an administrator needs to verify the platform's isolation and sessions.
 * Figures come from the database itself (pg_class, pg_roles, current_setting), not from config.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Role } from '@sampledge/core';
import { z } from 'zod';
import { requestApproval } from '../common/approvals';
import { AuditService } from '../common/audit.service';
import { Caller, ForModule, Write, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod';

/** Roles an administrator can assign here. Vendor and client members are tied to a vendor or client record, so they are set up with that record, not switched to or from. */
export const ASSIGNABLE_ROLES = ['platform_admin', 'executive', 'project_manager', 'survey_programmer', 'bizdev', 'data_processing', 'finance', 'panel_manager'] as const satisfies readonly Role[];
const RoleBody = z.object({ role: z.enum(ASSIGNABLE_ROLES) });
/** A phone number in international (E.164) form; spaces, dashes, dots and brackets are ignored. Null or empty removes it. */
const PhoneBody = z.object({
  phone: z.union([z.string().max(32), z.null()]).transform((v) => (v ? v.replace(/[\s\-().]/g, '') : null))
    .refine((v) => v === null || /^\+[1-9]\d{6,14}$/.test(v), 'Use the international form, for example +44 20 7946 0000'),
});
/** Only the last digits go into the audit trail. */
const masked = (p: string | null) => (p ? `…${p.slice(-4)}` : null);

@ForModule('admin')
@Controller('admin')
export class AdminController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  /** Workspace members with their role, MFA state and sign-in activity. Never returns password or MFA secrets. */
  @Get('users')
  async users(@Caller() ctx: Ctx) {
    const now = new Date();
    const members = await this.db.membership.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        user: { select: { id: true, name: true, email: true, mfaEnabled: true, createdAt: true } },
      },
    });
    const sessions = await this.db.session.findMany({ where: { tenantId: ctx.tenantId }, select: { userId: true, createdAt: true, revokedAt: true, expiresAt: true } });
    const byUser = new Map<string, { active: number; last: Date | null }>();
    for (const s of sessions) {
      const e = byUser.get(s.userId) ?? { active: 0, last: null };
      if (!s.revokedAt && s.expiresAt > now) e.active++;
      if (!e.last || s.createdAt > e.last) e.last = s.createdAt;
      byUser.set(s.userId, e);
    }
    return members
      .map((m) => ({
        id: m.user.id, name: m.user.name, email: m.user.email, role: m.role, vendorId: m.vendorId, clientId: m.clientId, phone: m.phone,
        mfaEnabled: m.user.mfaEnabled, joinedAt: m.user.createdAt,
        activeSessions: byUser.get(m.userId)?.active ?? 0, lastSignIn: byUser.get(m.userId)?.last ?? null,
        you: m.userId === ctx.userId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Changes a member's role. Not your own, not to or from vendor/client, and never the last platform admin.
   * Granting platform admin is a 'Granting admin access' approval that someone else decides.
   */
  @Patch('users/:id/role')
  @Write()
  async setRole(@Caller() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { role } = parse(RoleBody, body);
    if (id === ctx.userId) throw new ForbiddenException('You cannot change your own role. Ask another administrator.');
    return this.db.$transaction(async (tx) => {
      const m = await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, userId: id }, include: { user: { select: { name: true } } } });
      if (!m) throw new NotFoundException('Member not found');
      if (m.role === 'vendor' || m.role === 'client') throw new BadRequestException('Vendor and client accounts are tied to their vendor or client record and keep their role.');
      if (m.role === role) return { id, role, changed: false };
      if (m.role === 'platform_admin') {
        const admins = await tx.membership.count({ where: { tenantId: ctx.tenantId, role: 'platform_admin' } });
        if (admins <= 1) throw new BadRequestException('This is the last platform admin. Make someone else an admin first.');
      }
      if (role === 'platform_admin') {
        const open = await tx.approval.findFirst({ where: { tenantId: ctx.tenantId, kind: 'Granting admin access', status: 'pending', payload: { path: ['userId'], equals: id } } });
        if (open) throw new BadRequestException('A request to make this person a platform admin is already waiting for a decision.');
        const ap = await requestApproval(tx, { tenantId: ctx.tenantId, kind: 'Granting admin access', title: `Make ${m.user.name} a Platform Admin (now ${m.role})`, requestedBy: ctx.userId, payload: { userId: id, from: m.role } });
        await this.audit.log(ctx, 'role.change_requested', 'User', id, { name: m.user.name, role: m.role }, { name: m.user.name, role, approvalId: ap.id }, tx);
        return { id, role: m.role, changed: false, approvalId: ap.id };
      }
      await tx.membership.update({ where: { id: m.id }, data: { role } });
      // A role change takes effect on the next request; existing sessions stay valid but read the new role.
      await this.audit.log(ctx, 'role.changed', 'User', id, { name: m.user.name, role: m.role }, { name: m.user.name, role }, tx);
      return { id, role, changed: true };
    });
  }

  /** Records the phone number SMS from the Comms Hub uses for this member, in this workspace only. */
  @Patch('users/:id/phone')
  @Write()
  async setPhone(@Caller() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const { phone } = parse(PhoneBody, body);
    return this.db.$transaction(async (tx) => {
      const m = await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, userId: id }, include: { user: { select: { name: true } } } });
      if (!m) throw new NotFoundException('Member not found');
      if (m.phone === phone) return { id, phone, changed: false };
      await tx.membership.update({ where: { id: m.id }, data: { phone } });
      await this.audit.log(ctx, 'phone.changed', 'User', id, { name: m.user.name, phone: masked(m.phone) }, { name: m.user.name, phone: masked(phone) }, tx);
      return { id, phone, changed: true };
    });
  }

  /** Signs a member out everywhere by revoking their live sessions in this workspace. */
  @Post('users/:id/sessions/revoke')
  @Write()
  @HttpCode(200)
  async revokeSessions(@Caller() ctx: Ctx, @Param('id') id: string) {
    if (id === ctx.userId) throw new ForbiddenException('Use Sign out to end your own session.');
    return this.db.$transaction(async (tx) => {
      const m = await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, userId: id }, include: { user: { select: { name: true } } } });
      if (!m) throw new NotFoundException('Member not found');
      const r = await tx.session.updateMany({ where: { tenantId: ctx.tenantId, userId: id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      await this.audit.log(ctx, 'sessions.revoked', 'User', id, undefined, { name: m.user.name, sessions: r.count }, tx);
      return { id, revoked: r.count };
    });
  }

  /** Entities and actions present in the audit trail, for the filter menus of GET /audit. */
  @Get('audit/facets')
  async auditFacets(@Caller() ctx: Ctx) {
    const [entities, actions] = await Promise.all([
      this.db.auditLog.groupBy({ by: ['entity'], where: { tenantId: ctx.tenantId }, _count: { _all: true }, orderBy: { entity: 'asc' } }),
      this.db.auditLog.groupBy({ by: ['action'], where: { tenantId: ctx.tenantId }, _count: { _all: true }, orderBy: { action: 'asc' } }),
    ]);
    return { entities: entities.map((e) => ({ value: e.entity, count: e._count._all })), actions: actions.map((a) => ({ value: a.action, count: a._count._all })) };
  }

  /** Row-level security posture as Postgres reports it for this request's connection. */
  @Get('security')
  async security(@Caller() ctx: Ctx) {
    const [row] = await this.db.$transaction((tx) => tx.$queryRaw<{ tenant: string | null; role: string; bypass: boolean; forced: bigint; tables: bigint }[]>`
      SELECT current_setting('app.tenant_id', true) AS tenant,
             current_user AS role,
             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity) AS forced,
             (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenantId') AS tables`);
    const sessions = await this.db.session.count({ where: { tenantId: ctx.tenantId, revokedAt: null, expiresAt: { gt: new Date() } } });
    const enforced = !row.bypass && row.tenant === ctx.tenantId && Number(row.forced) >= Number(row.tables);
    return {
      rowLevelSecurity: {
        enforced,
        databaseRole: row.role,
        roleBypassesRls: row.bypass,
        tenantSeenByDatabase: row.tenant === ctx.tenantId ? 'matches your tenant' : row.tenant ? 'other' : 'not set',
        tablesWithTenantColumn: Number(row.tables),
        tablesWithForcedPolicies: Number(row.forced),
        note: row.bypass ? 'The API connects as a superuser or BYPASSRLS role, so Postgres skips the policies. Connect as an ordinary role.' : null,
      },
      activeSessions: sessions,
    };
  }
}

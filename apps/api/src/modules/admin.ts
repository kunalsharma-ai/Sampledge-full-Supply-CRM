/**
 * Admin & Security: what an administrator needs to verify the platform's isolation and sessions.
 * Figures come from the database itself (pg_class, pg_roles, current_setting), not from config.
 */
import { Controller, Get } from '@nestjs/common';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';

@ForModule('admin')
@Controller('admin')
export class AdminController {
  constructor(private db: PrismaService) {}

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

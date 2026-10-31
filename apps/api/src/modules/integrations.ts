/**
 * Integrations overview: every outside system Sampledge can talk to, with its real state read from
 * the server's configuration and recent activity. Never returns secrets, only whether one is set.
 *
 * States:
 *   connected     configured and has been used successfully
 *   configured    settings present, not yet seen working from here
 *   development   a stand-in that records instead of sending (e.g. email/SMS)
 *   off           can be connected by setting the listed variables
 *   not_built     no adapter exists yet
 */
import { Controller, Get, Injectable } from '@nestjs/common';
import { aiConfig, AiGateway } from '../ai/gateway';
import { samlConfig } from '../auth/saml';
import { ssoConfig } from '../auth/sso';
import { Caller, ForModule, type Ctx } from '../common/context';
import { PrismaService } from '../common/prisma.service';
import { panelConfig, panelIds, panelTenant } from '../integrations/panel-backend';
import { deliveryAdapter } from './worker';

export type IntegrationState = 'connected' | 'configured' | 'development' | 'off' | 'not_built';
export type Integration = {
  id: string; name: string; group: 'Panels' | 'AI' | 'Sign-in' | 'Messaging' | 'Finance' | 'Data' | 'Operations';
  state: IntegrationState; detail: string; settings: { name: string; set: boolean }[];
  lastActivity: { at: string; summary: string } | null; doc?: string;
};

const set = (...names: string[]) => names.map((name) => ({ name, set: !!process.env[name] }));

@Injectable()
export class IntegrationsService {
  constructor(private db: PrismaService, private ai: AiGateway) {}

  async list(ctx: Ctx): Promise<Integration[]> {
    const out: Integration[] = [];
    const tenant = await this.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } });
    const ownsPanels = tenant?.slug === panelTenant();

    for (const p of panelIds) {
      const c = panelConfig(p);
      const k = p.toUpperCase();
      const last = ownsPanels ? await this.db.panelCall.findFirst({ where: { tenantId: ctx.tenantId, panel: p, status: { in: ['sent', 'failed'] } }, orderBy: { createdAt: 'desc' } }) : null;
      const okBefore = ownsPanels ? await this.db.panelCall.count({ where: { tenantId: ctx.tenantId, panel: p, status: 'sent' } }) : 0;
      out.push({
        id: `panel-${p}`, name: c.name, group: 'Panels',
        state: !ownsPanels ? 'off' : !c.connected ? 'off' : okBefore ? 'connected' : 'configured',
        detail: !ownsPanels ? 'The panel connection belongs to another workspace.'
          : c.connected ? `Backend at ${new URL(c.url!).host}. Invites, soft launch and cancel need an approval.${okBefore ? '' : ' No call has succeeded yet.'}`
          : 'No backend URL or app token on the API server.',
        settings: ownsPanels ? set(`PANEL_${k}_URL`, `PANEL_${k}_TOKEN`) : [],
        lastActivity: last ? { at: last.createdAt.toISOString(), summary: `${last.action}: ${last.status}${last.error ? ` (${last.error.slice(0, 80)})` : ''}` } : null,
        doc: 'docs/integrations/TURN2OPINION.md',
      });
    }

    const a = aiConfig();
    const spend = await this.ai.monthSpend(ctx.tenantId);
    out.push({
      id: 'ai-anthropic', name: 'Claude (Anthropic API)', group: 'AI',
      state: a.provider === 'anthropic' ? (spend.calls ? 'connected' : 'configured') : 'off',
      detail: a.provider === 'anthropic'
        ? `AI tasks run on Claude, capped at $${a.capUsd} a month. ${spend.calls} call(s) this month, $${(Math.round(spend.usd * 100) / 100).toFixed(2)} spent.`
        : a.note ?? 'AI tasks run on built-in rules. Set AI_PROVIDER=anthropic and an API key to use Claude.',
      settings: set('AI_PROVIDER', 'ANTHROPIC_API_KEY', 'AI_MONTHLY_CAP_USD'),
      lastActivity: null,
    });

    const s = ssoConfig();
    out.push({
      id: 'sso-oidc', name: 'Single sign-on (OpenID Connect)', group: 'Sign-in',
      state: s.enabled ? 'configured' : 'off',
      detail: s.enabled ? `Identity provider ${new URL(s.issuer).host}, for workspace "${s.tenant}". People must already be members; MFA is the provider's.` : 'Password sign-in with optional two-factor codes.',
      settings: set('OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_TENANT'),
      lastActivity: null,
    });

    const sm = samlConfig();
    const samlLogins = sm.enabled ? await this.db.auditLog.count({ where: { tenantId: ctx.tenantId, action: 'auth.login', after: { path: ['method'], equals: 'saml' } } }) : 0;
    out.push({
      id: 'sso-saml', name: 'Single sign-on (SAML 2.0)', group: 'Sign-in',
      state: sm.enabled ? (samlLogins ? 'connected' : 'configured') : 'off',
      detail: sm.enabled ? `Identity provider ${sm.idpIssuer}, for workspace "${sm.tenant}". Signed assertions only; people must already be members; MFA is the provider's. Service metadata at /api/v1/auth/saml/metadata.` : 'Set the SAML_ variables to sign in through a SAML identity provider such as Okta, Entra ID or Google Workspace.',
      settings: set('SAML_ENTRY_POINT', 'SAML_IDP_ISSUER', 'SAML_IDP_CERT', 'SAML_SP_ENTITY_ID', 'SAML_CALLBACK_URL', 'SAML_TENANT'),
      lastActivity: null,
    });

    const sentAt = await this.db.message.findFirst({ where: { tenantId: ctx.tenantId, deliveredAt: { not: null } }, orderBy: { deliveredAt: 'desc' }, select: { deliveredAt: true } });
    const recorded = await this.db.message.count({ where: { tenantId: ctx.tenantId, deliveredAt: { gte: new Date(Date.now() - 30 * 86400_000) } } });
    out.push({
      id: 'messaging', name: 'Email and SMS delivery', group: 'Messaging', state: 'development',
      detail: `Adapter: ${deliveryAdapter.name}. ${recorded} message(s) recorded in the last 30 days; none left the system. Sends over the high-volume threshold still need an approval.`,
      settings: [], lastActivity: sentAt?.deliveredAt ? { at: sentAt.deliveredAt.toISOString(), summary: 'message recorded (not sent)' } : null,
    });

    out.push(
      { id: 'accounting', name: 'Accounting and payments', group: 'Finance', state: 'not_built', detail: 'Invoices, POs and payables live in Sampledge. Paid means recorded; no money moves and no accounting system is connected.', settings: [], lastActivity: null },
      { id: 'storage', name: 'File storage and BI tools', group: 'Data', state: 'not_built', detail: 'Reports and data export as PDF, CSV and SPSS downloads. No cloud storage or BI connector yet.', settings: [], lastActivity: null },
      { id: 'metrics', name: 'Prometheus metrics', group: 'Operations', state: process.env.METRICS_TOKEN ? 'configured' : 'off', detail: process.env.METRICS_TOKEN ? 'GET /metrics answers scrapers that send the token.' : 'Set METRICS_TOKEN to let a scraper read GET /metrics.', settings: set('METRICS_TOKEN'), lastActivity: null },
    );
    return out;
  }
}

@ForModule('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private s: IntegrationsService) {}
  @Get() list(@Caller() ctx: Ctx) { return this.s.list(ctx); }
}

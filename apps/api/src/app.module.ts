import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Headers, Module, NotFoundException } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { SharedThrottlerStorage } from './common/rate-limit-store';
import { PanelBackend } from './integrations/panel-backend';
import { PanelBackendController, PanelBackendService } from './integrations/panel-backend.controller';
import { PanelSyncService } from './integrations/panel-sync.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AuditService } from './common/audit.service';
import { config } from './common/config';
import { Public } from './common/context';
import { PrismaService } from './common/prisma.service';
import { CommercialController, CommercialService } from './modules/commercial';
import { ApprovalsController, ApprovalsService, OpsController } from './modules/ops';
import { PanelsController, PanelsService } from './modules/panels';
import { ProjectsController, ProjectsService } from './modules/projects';
import { RuntimeController, RuntimeService } from './modules/runtime';
import { SurveysController, SurveysService } from './modules/surveys';
import { RankingController, VendorsController, VendorsService } from './modules/vendors';
import { CommsController, CommsService } from './modules/comms';
import { FeasibilityController, FeasibilityService } from './modules/feasibility';
import { FinanceController, FinanceService } from './modules/finance';
import { EventsWorker } from './modules/worker';
import { IntegrationsController, IntegrationsService } from './modules/integrations';
import { DeliveriesController, PanelLedgerController, SettingsController } from './modules/supply-ops';
import './modules/supply-kinds';
import { SampAudienceRequestsController } from './integrations/sampleon/requests-proxy';
import { SupplyRecordsController, SupplyRecordsService } from './modules/supply-records';
import { SupplyFactsController, SupplyQuotasController, JourneysController, WeeklyProgrammeController } from './modules/supply-views';
import { AiController } from './ai/ai.controller';
import { DiyController, DiyService } from './modules/diy';
import { AdminController } from './modules/admin';
import { FinanceLedgersController } from './modules/finance-ledgers';
import { RetentionController } from './modules/retention';
import { renderMetrics } from './common/observability';
import { LiveController, LiveHub } from './common/live';
import { SamlController, SamlService } from './auth/saml';
import { SsoController, SsoService } from './auth/sso';
import { IdempotencyInterceptor } from './common/idempotency';
import { DpController, DpService } from './modules/dp';
import { DeliverablesController, DeliverablesService } from './modules/deliverables';
import { ReportSchedulesController, ReportSchedulesService } from './modules/report-schedules';
import { AiGateway } from './ai/gateway';
import { CrmInsightsController, InsightsController, InsightsService } from './modules/insights';
import { PanelAnalyticsController, PanelAnalyticsService } from './modules/panel-analytics';
import { AgentsController, AgentsService } from './modules/agents';
import { SupplyController, SupplyOverviewController } from './integrations/sampleon/supply.controller';
import { SupplyService } from './integrations/sampleon/supply.service';

/** Constant-time comparison, so response timing does not reveal how much of the token matched. */
function sameSecret(a: string, b: string) {
  const x = createHash('sha256').update(a).digest(), y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

@Controller('metrics')
class MetricsController {
  constructor(private db: PrismaService) {}
  /** Prometheus scrape endpoint. Off unless METRICS_TOKEN is set; the scraper sends it as a Bearer token. */
  @Public() @Get() @Header('content-type', 'text/plain; version=0.0.4')
  async metrics(@Headers('authorization') auth?: string) {
    const token = process.env.METRICS_TOKEN;
    if (!token || !sameSecret(auth ?? '', `Bearer ${token}`)) throw new NotFoundException();
    const [pending, failed, sessions] = await Promise.all([
      this.db.outboxEvent.count({ where: { processedAt: null } }),
      this.db.outboxEvent.count({ where: { processedAt: null, attempts: { gte: 5 } } }),
      this.db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return renderMetrics([
      { name: 'sampledge_outbox_pending', help: 'Workflow events waiting to be processed', value: pending },
      { name: 'sampledge_outbox_dead', help: 'Workflow events that exhausted their retries', value: failed },
      { name: 'sampledge_active_sessions', help: 'Unexpired, unrevoked sessions', value: sessions },
    ]);
  }
}

@Controller('health')
class HealthController {
  constructor(private db: PrismaService) {}
  @Public() @Get()
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    const pending = await this.db.outboxEvent.count({ where: { processedAt: null } });
    return { status: 'ok', db: 'ok', version: '0.11.0', outboxPending: pending };
  }
}

@Module({
  imports: [
    JwtModule.register({ secret: config.jwtSecret, signOptions: { issuer: 'sampledge-api' }, verifyOptions: { issuer: 'sampledge-api' } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: () => Number(process.env.RATE_LIMIT ?? 600) }]),
  ],
  controllers: [SupplyController, SupplyOverviewController, HealthController, MetricsController, AuthController, ProjectsController, CommercialController, VendorsController, RankingController, SurveysController, RuntimeController, PanelsController, ApprovalsController, OpsController, FeasibilityController, FinanceController, FinanceLedgersController, CommsController, AiController, DiyController, AdminController, RetentionController, DpController, SsoController, SamlController, DeliverablesController, ReportSchedulesController, LiveController, PanelBackendController, IntegrationsController, DeliveriesController, PanelLedgerController, SettingsController, SupplyRecordsController, SupplyFactsController, WeeklyProgrammeController, SupplyQuotasController, JourneysController, SampAudienceRequestsController, InsightsController, CrmInsightsController, PanelAnalyticsController, AgentsController],
  providers: [SupplyService, SupplyRecordsService, 
    PrismaService, AuditService, AuthService, ProjectsService, CommercialService, VendorsService, SurveysService, RuntimeService, PanelsService, ApprovalsService, FeasibilityService, FinanceService, CommsService, EventsWorker, AiGateway, DiyService, DpService, SsoService, SamlService, DeliverablesService, ReportSchedulesService, LiveHub, InsightsService, PanelAnalyticsService, AgentsService,
    SharedThrottlerStorage, PanelBackend, PanelBackendService, PanelSyncService, IntegrationsService,
    { provide: ThrottlerStorage, useExisting: SharedThrottlerStorage },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}

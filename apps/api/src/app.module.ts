import { Controller, Get, Header, Headers, Module, NotFoundException } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { AiController } from './ai/ai.controller';
import { DiyController, DiyService } from './modules/diy';
import { AdminController } from './modules/admin';
import { renderMetrics } from './common/observability';
import { LiveController, LiveHub } from './common/live';
import { SsoController, SsoService } from './auth/sso';
import { IdempotencyInterceptor } from './common/idempotency';
import { DpController, DpService } from './modules/dp';
import { AiGateway } from './ai/gateway';

@Controller('metrics')
class MetricsController {
  constructor(private db: PrismaService) {}
  /** Prometheus scrape endpoint. Off unless METRICS_TOKEN is set; the scraper sends it as a Bearer token. */
  @Public() @Get() @Header('content-type', 'text/plain; version=0.0.4')
  async metrics(@Headers('authorization') auth?: string) {
    const token = process.env.METRICS_TOKEN;
    if (!token || auth !== `Bearer ${token}`) throw new NotFoundException();
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
    return { status: 'ok', db: 'ok', version: '0.7.0', outboxPending: pending };
  }
}

@Module({
  imports: [
    JwtModule.register({ secret: config.jwtSecret, signOptions: { issuer: 'sampledge-api' }, verifyOptions: { issuer: 'sampledge-api' } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: () => Number(process.env.RATE_LIMIT ?? 600) }]),
  ],
  controllers: [HealthController, MetricsController, AuthController, ProjectsController, CommercialController, VendorsController, RankingController, SurveysController, RuntimeController, PanelsController, ApprovalsController, OpsController, FeasibilityController, FinanceController, CommsController, AiController, DiyController, AdminController, DpController, SsoController, LiveController],
  providers: [
    PrismaService, AuditService, AuthService, ProjectsService, CommercialService, VendorsService, SurveysService, RuntimeService, PanelsService, ApprovalsService, FeasibilityService, FinanceService, CommsService, EventsWorker, AiGateway, DiyService, DpService, SsoService, LiveHub,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}

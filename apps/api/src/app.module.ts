import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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

@Controller('health')
class HealthController {
  constructor(private db: PrismaService) {}
  @Public() @Get()
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok', version: '0.3.0' };
  }
}

@Module({
  imports: [
    JwtModule.register({ secret: config.jwtSecret, signOptions: { issuer: 'sampledge-api' }, verifyOptions: { issuer: 'sampledge-api' } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: () => Number(process.env.RATE_LIMIT ?? 600) }]),
  ],
  controllers: [HealthController, AuthController, ProjectsController, CommercialController, VendorsController, RankingController, SurveysController, RuntimeController, PanelsController, ApprovalsController, OpsController],
  providers: [
    PrismaService, AuditService, AuthService, ProjectsService, CommercialService, VendorsService, SurveysService, RuntimeService, PanelsService, ApprovalsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

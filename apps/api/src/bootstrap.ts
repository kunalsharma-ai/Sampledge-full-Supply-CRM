import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { assertConfig, config } from './common/config';
import { tenantScopeMiddleware } from './common/tenant-scope';
import { requestObservability, RequestIdFilter } from './common/observability';

export async function createApp() {
  assertConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: process.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'] });
  app.use(requestObservability);
  app.use(tenantScopeMiddleware);
  app.useGlobalFilters(new RequestIdFilter());
  app.use(cookieParser());
  app.disable('x-powered-by');
  // Behind a load balancer, rate limits and audit IPs must use the client address from
  // X-Forwarded-For: set TRUST_PROXY to the number of proxy hops (e.g. 1) or a subnet list.
  const tp = process.env.TRUST_PROXY;
  if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    // JSON and file responses only: nothing here should ever render as a page or be framed.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '12mb' }); // questionnaire uploads arrive base64-encoded (≤ 8 MB files)
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false }); // SAML responses are form posts
  app.enableShutdownHooks();
  return app;
}

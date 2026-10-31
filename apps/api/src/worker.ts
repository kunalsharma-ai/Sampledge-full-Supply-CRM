/**
 * Standalone outbox worker: `node dist/worker.js` with WORKER_INLINE=false on the API processes.
 * Several workers can run at once; rows are claimed with FOR UPDATE SKIP LOCKED and a lease.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertConfig } from './common/config';

async function main() {
  assertConfig();
  process.env.WORKER_INLINE = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  console.log('Sampledge outbox worker running');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

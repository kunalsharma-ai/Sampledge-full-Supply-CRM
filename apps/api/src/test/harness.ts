/**
 * Shared integration-test harness: points the API at database sampledge_test (created and migrated
 * on first use), seeds it, starts the app on a random port and signs in the demo users.
 */
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const base = process.env.DATABASE_URL ?? 'postgresql://sampledge:sampledge@localhost:5432/sampledge?schema=public';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? base.replace(/\/([^/?]+)(\?|$)/, '/sampledge_test$2');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-not-for-production';
process.env.RATE_LIMIT = '100000';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.WORKER_INLINE = 'false';
process.env.COMMS_HIGH_VOLUME = '20';

export type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const DEMO_PASSWORD = 'demo1234';
export const demoEmail = (role: string) => `${role.replace(/_/g, '.')}@demo.sampledge.test`;

export const h = {
  app: undefined as unknown as INestApplication,
  url: '',
  db: undefined as unknown as PrismaClient,
  tokens: {} as Record<string, string>,
  /** Runs the outbox worker until no events are pending. */
  drain: async () => {},
};

export async function call(method: string, p: string, body?: unknown, token?: string): Promise<Res> {
  const r = await fetch(`${h.url}/api/v1${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON (CSV) */ }
  return { status: r.status, body: parsed };
}

export const as = (who: string) => ({
  get: (p: string) => call('GET', p, undefined, h.tokens[who]),
  post: (p: string, b?: unknown) => call('POST', p, b ?? {}, h.tokens[who]),
  patch: (p: string, b: unknown) => call('PATCH', p, b, h.tokens[who]),
  put: (p: string, b: unknown) => call('PUT', p, b, h.tokens[who]),
});

export async function login(email: string, password = DEMO_PASSWORD) {
  const r = await call('POST', '/auth/login', { email, password, returnToken: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token as string;
}

export async function setup() {
  const admin = new PrismaClient({ datasources: { db: { url: base } } });
  const exists = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = 'sampledge_test'`;
  if (!exists.length) await admin.$executeRawUnsafe('CREATE DATABASE sampledge_test');
  await admin.$disconnect();
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../..'), env: process.env, stdio: 'ignore' });
  // Imported after the environment is set, so module-level config reads the test values.
  const { runSeed } = await import('../seed');
  const { createApp } = await import('../bootstrap');
  const { EventsWorker } = await import('../modules/worker');
  h.db = new PrismaClient();
  await runSeed(h.db, { panelists: 200 });
  h.app = await createApp();
  await h.app.listen(0);
  h.url = (await h.app.getUrl()).replace('[::1]', 'localhost');
  const worker = h.app.get(EventsWorker);
  h.drain = () => worker.drain();
  for (const r of ['platform_admin', 'executive', 'project_manager', 'survey_programmer', 'bizdev', 'finance', 'panel_manager', 'vendor', 'client', 'data_processing']) {
    h.tokens[r] = await login(demoEmail(r));
  }
  h.tokens.pm2 = await login('project.manager2@demo.sampledge.test');
  h.tokens.iso = await login('admin@isolation.sampledge.test');
}

export async function teardown() {
  await h.app?.close();
  await h.db?.$disconnect();
}

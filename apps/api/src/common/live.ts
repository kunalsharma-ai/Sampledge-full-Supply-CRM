/**
 * Live updates: Postgres NOTIFY → Server-Sent Events.
 *
 * Writers call `live(tx, …)` inside their transaction; Postgres delivers the notification only if the
 * transaction commits, and to every API process (so it works with the worker split out or several
 * API instances). Each API process keeps one LISTEN connection and fans events out to the browsers
 * connected to GET /api/v1/live, filtered by tenant and, for notifications, by role.
 * Payloads carry no record data beyond a title: browsers refetch through the normal, permission-checked API.
 */
import { Controller, Get, Injectable, Logger, OnModuleDestroy, Req, Res } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { Client } from 'pg';
import { Caller, type Ctx } from './context';

export type LiveEvent = { t: string; type: string; module?: string; roles?: string[]; title?: string };
const CHANNEL = 'sampledge_live';

/** Queue a live event in the caller's transaction (sent on commit). */
export function live(tx: { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number> }, e: LiveEvent) {
  return tx.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(e)})`;
}

@Injectable()
export class LiveHub implements OnModuleDestroy {
  private log = new Logger('Live');
  private bus = new EventEmitter().setMaxListeners(0);
  private client?: Client;
  private starting?: Promise<void>;
  private closed = false;

  private ensure() {
    if (this.client || this.starting || this.closed) return this.starting;
    this.starting = (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      c.on('notification', (m) => { try { this.bus.emit('event', JSON.parse(m.payload ?? '{}') as LiveEvent); } catch { /* ignore malformed */ } });
      c.on('error', (e) => { this.log.warn(`listener lost: ${e.message}; reconnecting`); this.client = undefined; setTimeout(() => void this.ensure(), 2000); });
      await c.connect();
      await c.query(`LISTEN ${CHANNEL}`);
      this.client = c;
    })().catch((e) => { this.log.warn(`listen failed: ${(e as Error).message}`); }).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async subscribe(fn: (e: LiveEvent) => void) {
    await this.ensure();
    this.bus.on('event', fn);
    return () => this.bus.off('event', fn);
  }

  async onModuleDestroy() {
    this.closed = true;
    await this.client?.end().catch(() => undefined);
  }
}

@Controller('live')
export class LiveController {
  constructor(private hub: LiveHub) {}

  /** Server-Sent Events for the signed-in user: changes in their workspace and notifications for their role. */
  @Get()
  async stream(@Caller() ctx: Ctx, @Req() req: Request, @Res() res: Response) {
    res.status(200).set({ 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    // no-transform: stops compressing proxies (including Next's) from buffering the stream.
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const off = await this.hub.subscribe((e) => {
      if (e.t !== ctx.tenantId) return;
      if (e.roles && !e.roles.includes(ctx.role)) return;
      res.write(`event: ${e.roles ? 'notification' : 'change'}\ndata: ${JSON.stringify({ type: e.type, module: e.module, title: e.roles ? e.title : undefined })}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); off(); });
  }
}

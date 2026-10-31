/**
 * Request ids, structured access logs and Prometheus metrics, without extra dependencies.
 *
 * - Every response carries `X-Request-Id` (a valid incoming id is kept, otherwise one is generated);
 *   error bodies and logs include it so a user's report can be traced.
 * - LOG_FORMAT=json writes one JSON line per request: time, id, method, route, status, ms, tenant, user.
 * - GET /api/v1/metrics serves Prometheus text when METRICS_TOKEN is set and sent as a Bearer token.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type Labels = Record<string, string>;
const counters = new Map<string, { help: string; values: Map<string, number> }>();
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const hist = new Map<string, { buckets: number[]; sum: number; count: number }>();
const key = (l: Labels) => Object.entries(l).map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`).join(',');

export function inc(name: string, help: string, labels: Labels, by = 1) {
  const c = counters.get(name) ?? { help, values: new Map() };
  counters.set(name, c);
  const k = key(labels);
  c.values.set(k, (c.values.get(k) ?? 0) + by);
}

function observe(labels: Labels, seconds: number) {
  const k = key(labels);
  const h = hist.get(k) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
  BUCKETS.forEach((b, i) => { if (seconds <= b) h.buckets[i]++; });
  h.sum += seconds; h.count++;
  hist.set(k, h);
}

export function requestObservability(req: Request & { ctx?: { tenantId: string; userId: string }; id?: string }, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w.:-]{8,100}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    // Route templates (/projects/:id), never raw paths, so labels stay bounded.
    const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    inc('http_requests_total', 'HTTP requests by route and status', labels);
    observe({ method: req.method, route }, seconds);
    if (process.env.LOG_FORMAT === 'json') {
      process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level: res.statusCode >= 500 ? 'error' : 'info', msg: 'request', id, method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000), tenant: req.ctx?.tenantId, user: req.ctx?.userId })}\n`);
    }
  });
  next();
}

export function renderMetrics(gauges: { name: string; help: string; value: number }[]) {
  const out: string[] = [];
  for (const [name, c] of counters) {
    out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
    for (const [k, v] of c.values) out.push(`${name}{${k}} ${v}`);
  }
  out.push('# HELP http_request_duration_seconds Request latency', '# TYPE http_request_duration_seconds histogram');
  for (const [k, h] of hist) {
    BUCKETS.forEach((b, i) => out.push(`http_request_duration_seconds_bucket{${k},le="${b}"} ${h.buckets[i]}`));
    out.push(`http_request_duration_seconds_bucket{${k},le="+Inf"} ${h.count}`, `http_request_duration_seconds_sum{${k}} ${h.sum.toFixed(6)}`, `http_request_duration_seconds_count{${k}} ${h.count}`);
  }
  const mem = process.memoryUsage();
  for (const g of [...gauges, { name: 'process_resident_memory_bytes', help: 'Resident memory', value: mem.rss }, { name: 'process_uptime_seconds', help: 'Process uptime', value: Math.round(process.uptime()) }]) {
    out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`, `${g.name} ${g.value}`);
  }
  return `${out.join('\n')}\n`;
}

import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** Adds the request id to error bodies and logs unexpected errors with it (no stack to the client). */
@Catch()
export class RequestIdFilter extends BaseExceptionFilter {
  private log = new Logger('Error');
  catch(e: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const body = e.getResponse();
      const status = e.getStatus();
      return res.status(status).json({ ...(typeof body === 'string' ? { statusCode: status, message: body } : body), requestId: req.id });
    }
    this.log.error(`${req.id} ${req.method} ${req.originalUrl}: ${(e as Error)?.stack ?? String(e)}`);
    return res.status(500).json({ statusCode: 500, message: 'Something went wrong on our side. Quote this request id if you report it.', requestId: req.id });
  }
}

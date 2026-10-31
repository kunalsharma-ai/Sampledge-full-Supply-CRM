/**
 * Idempotency-Key support for writes (POST, PUT, PATCH, DELETE) by signed-in callers.
 *
 * The first request with a key runs normally and its JSON response is stored for 24 hours. A retry
 * with the same key and body gets the stored response (and header `Idempotent-Replayed: true`)
 * without running the write again. The same key with a different body is refused (422); a retry
 * while the first request is still running gets 409. Failed requests release the key.
 * Clients should send a key on money-bearing and message-sending requests.
 */
import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, StreamableFile, UnprocessableEntityException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { from, of, type Observable } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import type { Ctx } from './context';
import { PrismaService } from './prisma.service';

const TTL_MS = 24 * 3600_000;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private db: PrismaService) {}

  intercept(ec: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ec.switchToHttp().getRequest<Request & { ctx?: Ctx }>();
    const res = ec.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !WRITES.has(req.method) || !req.ctx) return next.handle();
    if (!/^[\w.:-]{8,100}$/.test(key)) throw new UnprocessableEntityException('Idempotency-Key must be 8–100 letters, digits, dots, colons, dashes or underscores');
    const ctx = req.ctx;
    const path = req.originalUrl.split('?')[0];
    const bodyHash = createHash('sha256').update(`${req.method} ${path} ${JSON.stringify(req.body ?? null)}`).digest('hex');
    const where = { tenantId_userId_key: { tenantId: ctx.tenantId, userId: ctx.userId, key } };

    return from((async () => {
      const found = await this.db.idempotencyKey.findUnique({ where });
      if (found && found.createdAt.getTime() < Date.now() - TTL_MS) await this.db.idempotencyKey.delete({ where }).catch(() => undefined);
      else if (found) {
        if (found.bodyHash !== bodyHash) throw new UnprocessableEntityException('This Idempotency-Key was used for a different request');
        if (!found.status) throw new ConflictException('A request with this Idempotency-Key is still being processed');
        return { replay: found };
      }
      try {
        await this.db.idempotencyKey.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, key, method: req.method, path, bodyHash } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A request with this Idempotency-Key is still being processed');
        throw e;
      }
      return { replay: null };
    })()).pipe(
      mergeMap(({ replay }) => {
        if (replay) {
          res.status(replay.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(replay.response);
        }
        // Nest sets the status after interceptors run, so take it from the route's metadata.
        const status = (Reflect.getMetadata(HTTP_CODE_METADATA, ec.getHandler()) as number | undefined) ?? (req.method === 'POST' ? 201 : 200);
        return next.handle().pipe(
          // Stored before the response leaves, so an immediate retry is replayed rather than refused.
          mergeMap((body) => from(body instanceof StreamableFile
            ? this.db.idempotencyKey.delete({ where }).catch(() => undefined) // files are not replayed
            : this.db.idempotencyKey.update({ where, data: { status, response: (body ?? null) as Prisma.InputJsonValue } })).pipe(map(() => body))),
          catchError((err) => from(this.db.idempotencyKey.delete({ where }).catch(() => undefined)).pipe(mergeMap(() => { throw err; }))),
        );
      }),
    );
  }
}

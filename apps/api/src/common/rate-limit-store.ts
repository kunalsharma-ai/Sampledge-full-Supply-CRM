/**
 * Rate-limit counters kept in Postgres instead of process memory, so a limit (in particular the
 * sign-in limit) is shared by every API instance behind a load balancer. One atomic upsert per
 * request: a fixed window of `ttl` ms; going over `limit` blocks the key for `blockDuration` ms.
 * Set RATE_LIMIT_STORE=memory to use the in-process store (single instance only).
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';

type Row = { hits: number; resetAt: Date; blockedUntil: Date | null; now: Date };

@Injectable()
export class SharedThrottlerStorage implements ThrottlerStorage {
  private memory = process.env.RATE_LIMIT_STORE === 'memory' ? new ThrottlerStorageService() : null;
  constructor(private db: PrismaService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    if (this.memory) return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    const k = `${throttlerName}:${key}`;
    const ttlS = ttl / 1000, blockS = blockDuration / 1000;
    // While blocked the row is left alone. A finished window or block starts a new window at 1.
    // Otherwise count the hit, and block once the count passes the limit.
    const [r] = await this.db.$queryRaw<Row[]>`
      INSERT INTO "RateLimitBucket" AS b ("key", "hits", "resetAt", "blockedUntil")
      VALUES (${k}, 1, now() + make_interval(secs => ${ttlS}::float8), CASE WHEN 1 > ${limit}::int THEN now() + make_interval(secs => ${blockS}::float8) END)
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN b."blockedUntil" > now() THEN b."hits"
                      WHEN b."resetAt" <= now() OR b."blockedUntil" IS NOT NULL THEN 1
                      ELSE b."hits" + 1 END,
        "resetAt" = CASE WHEN b."blockedUntil" > now() THEN b."resetAt"
                         WHEN b."resetAt" <= now() OR b."blockedUntil" IS NOT NULL THEN now() + make_interval(secs => ${ttlS}::float8)
                         ELSE b."resetAt" END,
        "blockedUntil" = CASE WHEN b."blockedUntil" > now() THEN b."blockedUntil"
                              WHEN (b."resetAt" <= now() OR b."blockedUntil" IS NOT NULL) THEN CASE WHEN 1 > ${limit}::int THEN now() + make_interval(secs => ${blockS}::float8) END
                              WHEN b."hits" + 1 > ${limit}::int THEN now() + make_interval(secs => ${blockS}::float8)
                              ELSE NULL END
      RETURNING "hits", "resetAt", "blockedUntil", now() AS now`;
    const now = r.now.getTime();
    const blocked = !!r.blockedUntil && r.blockedUntil.getTime() > now;
    return {
      totalHits: r.hits,
      timeToExpire: Math.max(0, Math.ceil((r.resetAt.getTime() - now) / 1000)),
      isBlocked: blocked,
      timeToBlockExpire: blocked ? Math.ceil((r.blockedUntil!.getTime() - now) / 1000) : 0,
    };
  }
}

/**
 * Rate-limit counters kept in Postgres instead of process memory, so a limit (in particular the
 * sign-in limit) is shared by every API instance behind a load balancer. One atomic upsert per
 * request: a fixed window of `ttl` ms; going over `limit` blocks the key for `blockDuration` ms.
 * Set RATE_LIMIT_STORE=memory to use the in-process store (single instance only).
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
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
    // Times are UTC timestamps at millisecond precision, like every Prisma DateTime column, so the
    // database clock is the one clock all instances share and differences come out exact.
    const now = Prisma.sql`(now() AT TIME ZONE 'UTC')::timestamp(3)`;
    const end = (secs: number) => Prisma.sql`(${now} + make_interval(secs => ${secs}::float8))`;
    // While blocked the row is left alone. A finished window or block starts a new window at 1.
    // Otherwise count the hit, and block once the count passes the limit.
    const fresh = Prisma.sql`(b."resetAt" <= ${now} OR b."blockedUntil" IS NOT NULL)`;
    const blockedNow = Prisma.sql`(b."blockedUntil" > ${now})`;
    const [r] = await this.db.$queryRaw<Row[]>`
      INSERT INTO "RateLimitBucket" AS b ("key", "hits", "resetAt", "blockedUntil")
      VALUES (${k}, 1, ${end(ttlS)}, CASE WHEN 1 > ${limit}::int THEN ${end(blockS)} END)
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN ${blockedNow} THEN b."hits" WHEN ${fresh} THEN 1 ELSE b."hits" + 1 END,
        "resetAt" = CASE WHEN ${blockedNow} THEN b."resetAt" WHEN ${fresh} THEN ${end(ttlS)} ELSE b."resetAt" END,
        "blockedUntil" = CASE WHEN ${blockedNow} THEN b."blockedUntil"
                              WHEN ${fresh} THEN CASE WHEN 1 > ${limit}::int THEN ${end(blockS)} END
                              WHEN b."hits" + 1 > ${limit}::int THEN ${end(blockS)}
                              ELSE NULL END
      RETURNING "hits", "resetAt", "blockedUntil", ${now} AS now`;
    const at = r.now.getTime();
    const blocked = !!r.blockedUntil && r.blockedUntil.getTime() > at;
    return {
      totalHits: r.hits,
      timeToExpire: Math.max(0, Math.ceil((r.resetAt.getTime() - at) / 1000)),
      isBlocked: blocked,
      timeToBlockExpire: blocked ? Math.ceil((r.blockedUntil!.getTime() - at) / 1000) : 0,
    };
  }
}

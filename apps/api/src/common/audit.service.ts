import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Ctx } from './context';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private db: PrismaService) {}

  /** Append-only record of who changed what. Pass the transaction client so the entry commits with the change. */
  log(ctx: Pick<Ctx, 'tenantId' | 'userId' | 'name'>, action: string, entity: string, entityId: string, before?: unknown, after?: unknown, tx: Tx = this.db) {
    return tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        actor: ctx.name,
        action,
        entity,
        entityId,
        before: before === undefined ? undefined : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
        after: after === undefined ? undefined : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
      },
    });
  }
}

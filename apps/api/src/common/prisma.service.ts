import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { prismaOptions } from './db-adapter';
import { tenantScope } from './tenant-scope';

/**
 * Prisma client with row-level-security scoping.
 *
 * With a tenant in scope (see tenant-scope.ts) every model query runs in a short transaction that
 * first sets `app.tenant_id`; interactive transactions set it once at their start. The policies in
 * migration `phase6_rls` then restrict every tenant table to that tenant. Without a tenant in scope
 * the setting stays empty and the policies let the query through (system work).
 *
 * The constructor returns the extended client, so the injected `PrismaService` is that client.
 */
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super(prismaOptions());
    const base = this as PrismaClient;
    const setTenant = (client: { $executeRaw: PrismaClient['$executeRaw'] }, id: string) => client.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    const ext = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const s = tenantScope.getStore();
            if (!s?.tenantId || s.inTx) return query(args);
            const [, result] = await base.$transaction([setTenant(base, s.tenantId), query(args)]);
            return result;
          },
        },
      },
      client: {
        async onModuleInit() {
          await base.$connect();
          const [r] = await base.$queryRaw<{ bypass: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`;
          if (r?.bypass) new Logger('Database').warn('Connected as a superuser or BYPASSRLS role: row-level security is not enforced. Use an ordinary role (see docker/db-init.sql).');
        },
        async onModuleDestroy() { await base.$disconnect(); },
      },
    });
    // Interactive transactions: set the tenant on the transaction's connection, then mark the scope so
    // queries inside it are not wrapped again.
    const origTx = ext.$transaction.bind(ext) as (a: unknown, o?: unknown) => Promise<unknown>;
    const tx = (arg: unknown, opts?: unknown) => {
      const s = tenantScope.getStore();
      if (typeof arg !== 'function' || !s?.tenantId || s.inTx) return origTx(arg, opts);
      const fn = arg as (t: unknown) => Promise<unknown>;
      return origTx(async (t: { $executeRaw: PrismaClient['$executeRaw'] }) => {
        await setTenant(t, s.tenantId!);
        return tenantScope.run({ ...s, inTx: true }, () => fn(t));
      }, opts);
    };
    return new Proxy(ext, { get: (target, prop, recv) => (prop === '$transaction' ? tx : Reflect.get(target, prop, recv)) }) as unknown as PrismaService;
  }
}

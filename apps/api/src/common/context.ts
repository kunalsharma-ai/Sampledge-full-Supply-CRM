import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ModuleId, Permission, Role } from '@sampledge/core';

/** The authenticated caller. Every service method takes this and scopes queries by tenantId. */
export type Ctx = {
  userId: string;
  sessionId: string;
  tenantId: string;
  role: Role;
  name: string;
  email: string;
  vendorId: string | null;
  clientId: string | null;
};

export const PUBLIC = 'sampledge:public';
export const MODULE = 'sampledge:module';
export const PERMS = 'sampledge:perms';
export const WRITE = 'sampledge:write';

/** Route needs no session (login, respondent runtime, health). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Module whose role-access row gates this controller (see core roles.ts). */
export const ForModule = (m: ModuleId) => SetMetadata(MODULE, m);
/** Route needs every listed permission. */
export const RequirePerm = (...p: Permission[]) => SetMetadata(PERMS, p);
/** Route changes data: needs 'full' module access (or 'scoped' for scoped roles where the service checks ownership). */
export const Write = (opts: { allowScoped?: boolean } = {}) => SetMetadata(WRITE, opts);

export const Caller = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => ec.switchToHttp().getRequest().ctx);

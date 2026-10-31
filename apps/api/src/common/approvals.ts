import type { Permission, Role } from '@sampledge/core';
import { Prisma } from '@prisma/client';
import { emit } from './events';

/**
 * Actions the master prompt says must never complete without a human decision.
 * Each kind maps to the permission a decider needs. Kinds with no permission key yet fall back
 * to platform_admin or executive.
 */
export const approvalKinds = {
  'Sending binding quotations': 'approve:quotes',
  'Purchasing sample': 'approve:purchase',
  'Issuing payments': 'approve:payments',
  'Publishing surveys': 'approve:publish',
  'Rejecting respondents': 'edit:projects',
  'Releasing sensitive datasets': null,
  'Deleting records': null,
  'High-volume communications': 'edit:automations',
  'Granting admin access': null,
} as const satisfies Record<string, Permission | null>;

export type ApprovalKind = keyof typeof approvalKinds;
export const fallbackDeciders: Role[] = ['platform_admin', 'executive'];

/** Creates a pending approval and announces it, inside the caller's transaction. */
export async function requestApproval(
  tx: Prisma.TransactionClient,
  data: { tenantId: string; kind: ApprovalKind; title: string; requestedBy: string; projectId?: string | null; amount?: number | null; payload?: Record<string, unknown>; agentId?: string },
) {
  const a = await tx.approval.create({ data: { ...data, payload: (data.payload ?? {}) as Prisma.InputJsonValue } });
  await emit(tx, data.tenantId, 'approval.requested', { approvalId: a.id, kind: a.kind });
  return a;
}

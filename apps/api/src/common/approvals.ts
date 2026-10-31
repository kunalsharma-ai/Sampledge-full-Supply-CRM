import type { Permission, Role } from '@sampledge/core';

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
} as const satisfies Record<string, Permission | null>;

export type ApprovalKind = keyof typeof approvalKinds;
export const fallbackDeciders: Role[] = ['platform_admin', 'executive'];

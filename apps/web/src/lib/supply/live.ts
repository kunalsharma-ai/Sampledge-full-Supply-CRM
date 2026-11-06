'use client';
/**
 * Loaders for SUPPLY360 screens that read endpoints which already exist in apps/api. Each one is
 * passed to `useSupplyData` as the live loader; when the API is not connected the screen keeps its
 * labelled demo set (or, where there is no sensible demo, says what connecting would show).
 */
import { api } from '../api';
import type { Role } from '@sampledge/core';

/** `GET /panels/sampleon/overview`: what SampAudience has done with this workspace's panellists. */
export type SampOverview = { cards: Record<string, number>; participation: Record<string, number>; rewardPointsNet: number };
export const loadSampOverview = () => api<SampOverview>('/panels/sampleon/overview');

/** `GET /integrations`: each connection's configuration state on the API server. Secrets are never returned, only whether they are set. */
export type LiveIntegration = {
  id: string; name: string; group: string; state: 'connected' | 'configured' | 'development' | 'off' | 'not_built';
  detail: string; settings: { name: string; set: boolean }[]; lastActivity: { at: string; summary: string } | null; doc?: string;
};
export const loadIntegrations = () => api<LiveIntegration[]>('/integrations');

/** `GET /admin/users`: workspace members and their sign-in role. Admins only. */
export type LiveMember = {
  id: string; name: string; email: string; role: Role; vendorId: string | null; clientId: string | null;
  mfaEnabled: boolean; joinedAt: string; activeSessions: number; lastSignIn: string | null; you: boolean;
};
export const loadMembers = () => api<LiveMember[]>('/admin/users');
/** `PATCH /admin/users/:id/role`. Granting platform admin opens an approval instead of applying. */
export const setMemberRole = (id: string, role: Role) => api<{ id: string; role: Role; changed: boolean; approvalId?: string }>(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } });

/** Card and participation statuses as the SampAudience tables store them, with plain labels. */
export const cardStatus: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'started', label: 'Started' }, { key: 'completed', label: 'Completed' }, { key: 'screened_out', label: 'Screened out' }, { key: 'withdrawn', label: 'Withdrawn' },
];
export const participationStatus: { key: string; label: string }[] = [
  { key: 'started', label: 'Started' }, { key: 'complete', label: 'Complete' }, { key: 'terminate', label: 'Screened out' }, { key: 'quota_full', label: 'Quota full' }, { key: 'quality_fail', label: 'Quality fail' },
];

/** Which notification lane a live notification belongs in, from its wording. */
export function laneOf(title: string): 'act' | 'review' | 'fyi' {
  if (/approval|needed|at risk|behind|failed|overdue|blocked/i.test(title)) return 'act';
  if (/found|issue|full|new |review|waiting/i.test(title)) return 'review';
  return 'fyi';
}
/** Where a live notification's module is handled on the SUPPLY360 screens. */
export const moduleHref: Record<string, { href: string; source: string }> = {
  projects: { href: '/supply/quotas', source: 'Quotas' },
  'survey-studio': { href: '/supply/surveys', source: 'Surveys' },
  crm: { href: '/supply/projexa-requests', source: 'Requests' },
  automation: { href: '/supply/automation', source: 'Automation' },
  marketplace: { href: '/supply/sampleon', source: 'SampAudience' },
  panels: { href: '/supply/panellists', source: 'Panels' },
  finance: { href: '/supply/rewards', source: 'Rewards' },
  communications: { href: '/supply/email', source: 'Comms' },
};

/** `GET /integrations/deliveries`: the outbox as a delivery log (no payloads). */
export type LiveDelivery = { id: string; type: string; createdAt: string; processedAt: string | null; attempts: number; lastError: string | null; status: 'delivered' | 'queued' | 'retrying' | 'failed' };
export const loadDeliveries = (status?: LiveDelivery['status']) => api<LiveDelivery[]>(`/integrations/deliveries?take=100${status ? `&status=${status}` : ''}`);
export const retryDelivery = (id: string) => api<{ id: string; status: 'queued' }>(`/integrations/deliveries/${id}/retry`, { method: 'POST' });

/** `GET /panels/ledger`: incentive entries with the member's handle and brand. */
export type LiveLedgerEntry = {
  id: string; createdAt: string; kind: 'earn' | 'redeem' | 'adjust' | 'expire'; points: number; valueBase: number;
  status: 'posted' | 'pending_approval' | 'rejected'; projectId: string | null; note: string | null; createdBy: string;
  panelist: { id: string; handle: string; brand: string } | null;
};
export const loadLedger = () => api<LiveLedgerEntry[]>('/panels/ledger?take=200');

/** `GET /admin/settings` and `PATCH /admin/settings`. */
export type LiveSettings = {
  values: Record<string, string | number | boolean>;
  managed: Record<string, { label: string; href: string }>;
  history: { id: string; at: string; who: string; setting: string; from: string | number | boolean | null; to: string | number | boolean | null }[];
};
export const loadSettings = () => api<LiveSettings>('/admin/settings');
export const saveSettings = (changes: Record<string, string | number | boolean>) => api<{ values: LiveSettings['values']; changed: number }>('/admin/settings', { method: 'PATCH', body: { changes } });

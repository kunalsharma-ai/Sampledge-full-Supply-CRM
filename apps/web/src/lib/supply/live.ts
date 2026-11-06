'use client';
/**
 * Loaders for SUPPLY360 screens that read endpoints which already exist in apps/api. Each one is
 * passed to `useSupplyData` as the live loader; when the API is not connected the screen keeps its
 * labelled demo set (or, where there is no sensible demo, says what connecting would show).
 */
import type { WfEdge, WfNode } from './engagement';
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

/** `/supply/records/:kind`: SUPPLY360 working records (weekly weeks, saved reports, tickets ...). */
export type Rec<T> = { id: string; ref: string; kind: string; status: string; title: string; data: T; version: number; createdBy: string; createdAt: string; updatedAt: string };
export const records = {
  list: <T>(kind: string, q = '') => api<Rec<T>[]>(`/supply/records/${kind}${q ? `?${q}` : ''}`),
  get: <T>(kind: string, id: string) => api<Rec<T>>(`/supply/records/${kind}/${id}`),
  create: <T>(kind: string, data: Partial<T>) => api<Rec<T>>(`/supply/records/${kind}`, { method: 'POST', body: { data } }),
  update: <T>(kind: string, r: Pick<Rec<T>, 'id' | 'version'>, data: Partial<T>) => api<Rec<T>>(`/supply/records/${kind}/${r.id}`, { method: 'PATCH', body: { data, version: r.version } }),
  act: <T>(kind: string, r: Pick<Rec<T>, 'id' | 'version'>, action: string, extra: Record<string, unknown> = {}) => api<Rec<T>>(`/supply/records/${kind}/${r.id}/${action}`, { method: 'POST', body: { version: r.version, ...extra } }),
};

/** `GET /supply/facts`: analytics fact rows counted from recorded activity. */
export type LiveFacts = { asOf: string; weeks: string[]; pointValue: number; currency: string; facts: { panel: string; country: string; week: string; source: string; completes: number; starts: number; invites: number; signups: number; points: number }[] };
export const loadFacts = (weeks = 8) => api<LiveFacts>(`/supply/facts?weeks=${weeks}`);

/** `GET /supply/weekly-programme`. */
export type WeeklyData = { week: string; template: string; topics: string[]; brands: string[]; audienceRequestId?: string; note?: string };
export type LiveWeek = Rec<WeeklyData> & { invites: number; completes: number; cost: number };
export const loadWeeklyProgramme = () => api<LiveWeek[]>('/supply/weekly-programme');

/** `GET /projects` (fieldwork projects with quota cells) and closing a cell early. */
export type LiveProject = {
  id: string; code: string; name: string; stage: string; start: string; deadline: string; countries: string[]; completes: number; target: number; loi: number; ir: number; cpiSell?: number; audience: string;
  quotas: { id: string; key: string; label: string; target: number; count: number; hard: boolean; closedAt: string | null }[];
  surveys: { id: string; name: string; status: string }[];
};
export const loadProjects = () => api<LiveProject[]>('/projects');
export const closeQuota = (id: string, reason: string) => api<{ id: string; closedAt: string }>(`/supply/quotas/${id}/close`, { method: 'POST', body: { reason } });
export const reopenQuota = (id: string) => api<{ id: string; closedAt: null }>(`/supply/quotas/${id}/reopen`, { method: 'POST' });

/** Communications records (`campaign`, `newsletter`): sending queues a Comms Hub message. */
export type SendState = { sendAt?: string; messageId?: string; recipients?: number; needsApproval?: boolean; sentAt?: string; error?: string };
export type CampaignData = SendState & { name: string; brand: string; segment: 'active' | 'dormant' | 'all'; subjectA: string; subjectB?: string; split: number; blocks: { id: string; kind: 'heading' | 'text' | 'button' | 'image' | 'survey' | 'divider'; text: string }[] };
export type NewsletterData = SendState & { title: string; brand: string; stories: string[]; intro?: string };
/** `GET /comms/preview`: consent-filtered recipients for a panel segment. */
export type CommsPreview = { recipients: number; label: string; needsApproval: boolean; threshold: number; adapter: string };
export const previewPanel = (brand: string, segment: string) => api<CommsPreview>(`/comms/preview?audience=panel&target=${encodeURIComponent(`panel:${brand}:${segment}`)}`);
export type LiveMessage = { id: string; status: string; recipients: number; deliveredAt: string | null; relatedId: string | null; error: string | null };
export const loadMessages = () => api<LiveMessage[]>('/comms/messages?take=200');
export const messageLabel: Record<string, string> = { pending_approval: 'Awaiting approval', queued: 'Queued', delivered_dev: 'Delivered (development adapter)', delivered: 'Delivered', failed: 'Failed', cancelled: 'Cancelled' };

/** `GET /supply/journeys`: lifecycle stages counted for a joining cohort. */
export type LiveJourneys = { asOf: string; days: number; stages: string[]; notTracked: string[]; counts: Record<'t2o' | 'mfr' | 'mho', number[]>; medianDaysToFirst: Record<string, number | null> };
export const loadJourneys = (days = 90) => api<LiveJourneys>(`/supply/journeys?days=${days}`);
/** Panel brand ids as the API stores them. */
export const apiBrand: Record<'t2o' | 'mfr' | 'mho', string> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };
export const brandFromApi: Record<string, 't2o' | 'mfr' | 'mho'> = { turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };

/** Members by id or handle (`GET /panels/panelists?ids=` / `?q=`), in the API's shape. */
export type ApiPanelist = { id: string; brand: string; handle: string; country: string; ageBand: string; gender: string; segment: string; status: string; qualityScore: number; points: number; profileCompletion: number; surveysCompleted: number; joinedAt: string; lastActiveAt: string | null };
export const loadPanelistsByIds = async (ids: string[]) => (ids.length ? (await api<{ rows: ApiPanelist[] }>(`/panels/panelists?take=200&ids=${encodeURIComponent([...new Set(ids)].slice(0, 200).join(','))}`)).rows : []);
export const searchPanelists = async (q: string) => (await api<{ rows: ApiPanelist[] }>(`/panels/panelists?take=8&q=${encodeURIComponent(q)}`)).rows;
export const loadMemberLedger = (panelistId: string) => api<LiveLedgerEntry[]>(`/panels/ledger?take=5&panelistId=${encodeURIComponent(panelistId)}`);

/** Support tickets (`ticket` records). */
export type TicketMsg = { from: 'member' | 'agent' | 'note'; author: string; text: string; at: string };
export type TicketData = { subject: string; category: 'Rewards' | 'Survey issue' | 'Account' | 'Privacy' | 'Technical'; priority: 'urgent' | 'high' | 'normal' | 'low'; channel: 'Email' | 'In app' | 'Chat' | 'Phone'; panelistId: string; messages: TicketMsg[] };
/** Hours to the first answer by priority (same as the API's slaHours). */
export const slaHours = { urgent: 4, high: 12, normal: 24, low: 72 } as const;

/** Quality cases (`quality_case` records) and the quality summary. */
export type QualityCaseData = { panelistId: string; rule: string; score: number; signals: string[]; note?: string; priorStatus?: string; decidedReason?: string };
export type QualitySummary = {
  asOf: string; members: number; bad: number; bands: number[]; cases: Record<string, number>;
  outcomes: { thisWeek: { total: number; by: Record<string, number> }; lastWeek: { total: number; by: Record<string, number> } };
  backtest: { threshold: number; flagged: number; recall: number; precision: number }[];
};
export const loadQualitySummary = () => api<QualitySummary>('/supply/quality/summary');
export const scanQuality = (threshold: number) => api<{ opened: number; threshold: number; skipped: number }>('/supply/quality/scan', { method: 'POST', body: { threshold } });
/** "3m ago" style time for ISO strings. */
export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

/** `workflow` record data (see apps/api/src/modules/workflows.ts). */
export type WorkflowData = { name: string; panel: 'all' | 't2o' | 'mfr' | 'mho'; nodes: WfNode[]; edges: WfEdge[]; activatedAt?: string };
export type WorkflowRunRow = { id: string; member: string; status: 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'; nodeId: string | null; wakeAt: string | null; path: { node: string; at: string; note?: string }[]; note: string | null; startedAt: string; updatedAt: string };
export type WorkflowRuns = { stats: { runs7d: number; completed7d: number; waiting: number; failed: number }; runs: WorkflowRunRow[] };
/** `GET /supply/workflows/:id/runs`: the 50 latest runs and 7-day counts. */
export const loadWorkflowRuns = (id: string) => api<WorkflowRuns>(`/supply/workflows/${id}/runs`);
/** `POST /supply/workflows/:id/test`: the path one member would take today; sends nothing. */
export const testWorkflow = (id: string) => api<{ member: { handle: string; country: string; segment: string }; path: { node: string; note: string }[] }>(`/supply/workflows/${id}/test`, { method: 'POST', body: {} });

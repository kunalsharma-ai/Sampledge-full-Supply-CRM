'use client';
/**
 * SUPPLY360 data access for Audience Orbit X screens.
 *
 * Each screen asks for data through `useSupplyData`, giving a live loader (an existing API endpoint)
 * and a demo fallback. When the API is connected and the endpoint answers, the screen shows real
 * records; otherwise it shows the synthetic set from ./demo.ts with a "Demo data" badge.
 *
 * `endpoints` lists the backend integration points each screen expects. Paths marked `planned` do
 * not exist in apps/api yet; SAMPLEON paths follow the contract from the integration work.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useOS } from '../store';
import { panelStats, type PanelId } from './demo';

export type Source = 'live' | 'demo';
export type SupplyQuery<T> = { data: T; source: Source; loading: boolean; error: string | null; reload: () => void };

export function useSupplyData<T>(key: string, demo: () => T, live?: () => Promise<T | null>): SupplyQuery<T> {
  const mode = useOS((s) => s.mode);
  const session = useOS((s) => s.session);
  const [state, setState] = useState<{ data: T; source: Source; loading: boolean; error: string | null }>(() => ({ data: demo(), source: 'demo', loading: !!live, error: null }));
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!live || mode !== 'live' || !session) { setState((s) => ({ ...s, loading: mode === 'connecting' })); return; }
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    live()
      .then((d) => { if (!off) setState(d == null ? { data: demo(), source: 'demo', loading: false, error: null } : { data: d, source: 'live', loading: false, error: null }); })
      .catch((e: unknown) => { if (!off) setState({ data: demo(), source: 'demo', loading: false, error: e instanceof Error ? e.message : 'Could not load' }); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, session, n]);
  return { ...state, reload };
}

type ApiPanelSummary = { id: string; name: string; records: number; active: number; avgQuality: number; profileCompletion: number };

/** Panel brand cards: membership and profile completion from GET /panels/summary when live. */
export async function loadPanelStats() {
  const rows = await api<ApiPanelSummary[]>('/panels/summary');
  if (!rows?.length) return null;
  return panelStats.map((p) => {
    const row = rows.find((x) => x.id === p.id || x.name === p.name);
    return row ? { ...p, members: row.records, active30: row.active, profileCompletion: row.profileCompletion || p.profileCompletion } : p;
  });
}

export const endpoints = {
  panelSummary: { method: 'GET', path: '/panels/summary', status: 'available' },
  panelists: { method: 'GET', path: '/panels/panelists', status: 'available' },
  panelist: { method: 'GET', path: '/panels/panelists/:id', status: 'available' },
  panelAnalytics: { method: 'GET', path: '/panels/analytics', status: 'available' },
  rewardPolicy: { method: 'GET', path: '/panels/reward-policy', status: 'available' },
  supplyOverview: { method: 'GET', path: '/supply/overview', status: 'planned' },
  audienceRequests: { method: 'GET', path: '/sampaudience/requests', status: 'available' },
  audienceRequest: { method: 'GET', path: '/sampaudience/requests/:id', status: 'available' },
  sampaudienceStatus: { method: 'GET', path: '/sampaudience/status', status: 'available' },
  decide: { method: 'POST', path: '/approvals/:id/decision', status: 'available' },
  surveys: { method: 'GET', path: '/sampaudience/requests', status: 'available' },
  launch: { method: 'POST', path: 'SampAudience console', status: 'console' },
  batch: { method: 'PATCH', path: 'SampAudience console', status: 'console' },
  routingFlows: { method: 'GET', path: '/sampaudience/requests (routing counts)', status: 'available' },
  quotaAction: { method: 'POST', path: '/panel-backend/:panel/projects/:id/actions', status: 'available' },
  workflows: { method: 'PUT', path: '/automation/workflows/:id', status: 'planned' },
  campaigns: { method: 'GET', path: '/supply/records/campaign', status: 'available' },
  campaignSend: { method: 'POST', path: '/supply/records/campaign/:id/send', status: 'available' },
  commsPreview: { method: 'GET', path: '/comms/preview', status: 'available' },
  newsletters: { method: 'GET', path: '/supply/records/newsletter', status: 'available' },
  journeys: { method: 'GET', path: '/supply/journeys', status: 'available' },
  notifications: { method: 'GET', path: '/notifications', status: 'available' },
  notificationRead: { method: 'POST', path: '/notifications/:id/read', status: 'available' },
  weeklyProgramme: { method: 'GET', path: '/supply/weekly-programme', status: 'available' },
  records: { method: 'GET', path: '/supply/records/:kind', status: 'available' },
  facts: { method: 'GET', path: '/supply/facts', status: 'available' },
  quotaClose: { method: 'POST', path: '/supply/quotas/:id/close', status: 'available' },
  surveyDraft: { method: 'POST', path: '/ai/survey-draft', status: 'planned' },
  ledger: { method: 'GET', path: '/panels/ledger', status: 'available' },
  tickets: { method: 'GET', path: '/support/tickets', status: 'planned' },
  ticketMessage: { method: 'POST', path: '/support/tickets/:id/messages', status: 'planned' },
  qualityCases: { method: 'GET', path: '/quality/cases', status: 'planned' },
  events: { method: 'GET', path: '/panels/events', status: 'planned' },
  sampleonOverview: { method: 'GET', path: '/panels/sampleon/overview', status: 'available' },
  approveAllocation: { method: 'POST', path: 'SampAudience console', status: 'console' },
  counterPropose: { method: 'PATCH', path: 'SampAudience console', status: 'console' },
  redirectTest: { method: 'POST', path: 'SampAudience console', status: 'console' },
  copilot: { method: 'POST', path: '/ai/copilot', status: 'planned' },
  reports: { method: 'POST', path: '/supply/records/report', status: 'available' },
  reportSchedule: { method: 'PUT', path: '/reports/:id/schedule', status: 'planned' },
  integrationsConfig: { method: 'GET', path: '/integrations', status: 'available' },
  connections: { method: 'GET', path: '/integrations/connections', status: 'planned' },
  deliveries: { method: 'GET', path: '/integrations/deliveries', status: 'available' },
  deliveryRetry: { method: 'POST', path: '/integrations/deliveries/:id/retry', status: 'available' },
  apiKeys: { method: 'POST', path: '/integrations/keys', status: 'planned' },
  members: { method: 'GET', path: '/admin/users', status: 'available' },
  memberRole: { method: 'PATCH', path: '/admin/users/:id/role', status: 'available' },
  roleCapabilities: { method: 'PUT', path: '/admin/roles/:id/capabilities', status: 'planned' },
  overrides: { method: 'POST', path: '/admin/overrides', status: 'planned' },
  settings: { method: 'PATCH', path: '/admin/settings', status: 'available' },
  settingsRead: { method: 'GET', path: '/admin/settings', status: 'available' },
} as const;

export type PanelStat = (typeof panelStats)[number] & { id: PanelId };

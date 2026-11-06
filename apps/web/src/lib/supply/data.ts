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
  audienceRequests: { method: 'GET', path: '/sampleon/v1/audience-requests', status: 'planned' },
  decide: { method: 'POST', path: '/approvals/:id/decision', status: 'available' },
  surveys: { method: 'GET', path: '/sampleon/v1/surveys', status: 'planned' },
  launch: { method: 'POST', path: '/sampleon/v1/surveys/:id/launch', status: 'planned' },
  batch: { method: 'PATCH', path: '/sampleon/v1/batches/:id', status: 'planned' },
  routingFlows: { method: 'GET', path: '/sampleon/v1/routing/flows', status: 'planned' },
  quotaAction: { method: 'POST', path: '/panel-backend/:panel/projects/:id/actions', status: 'available' },
  workflows: { method: 'PUT', path: '/automation/workflows/:id', status: 'planned' },
  campaignSend: { method: 'POST', path: '/communications/campaigns/:id/send', status: 'planned' },
  newsletters: { method: 'GET', path: '/communications/newsletters', status: 'planned' },
  notifications: { method: 'GET', path: '/notifications', status: 'planned' },
  weeklyProgramme: { method: 'GET', path: '/panels/weekly-programme', status: 'planned' },
  surveyDraft: { method: 'POST', path: '/ai/survey-draft', status: 'planned' },
  ledger: { method: 'GET', path: '/panels/ledger', status: 'planned' },
  tickets: { method: 'GET', path: '/support/tickets', status: 'planned' },
  ticketMessage: { method: 'POST', path: '/support/tickets/:id/messages', status: 'planned' },
  qualityCases: { method: 'GET', path: '/quality/cases', status: 'planned' },
  events: { method: 'GET', path: '/panels/events', status: 'planned' },
} as const;

export type PanelStat = (typeof panelStats)[number] & { id: PanelId };

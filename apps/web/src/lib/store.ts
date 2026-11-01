'use client';
/**
 * Application state shared by every module, so an action in one module (e.g. winning a CRM deal)
 * shows up everywhere without re-entry.
 *
 * Two modes:
 *  - live:    signed in to the API. Records are loaded from Postgres, every change is an API call,
 *             and the server enforces roles, tenant scope, redaction and approvals.
 *  - offline: the API is not reachable (e.g. a static preview). Phase 2 behaviour: seed records in
 *             localStorage, labelled "Offline demo" in the top bar. Nothing leaves the browser.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  approvals as approvalsSeed, agents as agentsSeed, notificationsSeed, opportunities as oppSeed, projects as projectSeed,
  surveys as surveySeed, lifecycle, type CrmStage, type LifecycleStage, type Opportunity, type Project, type SurveySummary,
} from './core';
import { cloudSurvey } from './core';
import { applyQuotas, type Answers, type Outcome, type SurveyDef } from './core';
import { access, type Role, type Vendor } from './core';
import { setRegistries, vendors as vendorSeed } from './core';
import {
  api, apiAll, ApiError, ApiUnreachable, demoEmail, DEMO_PASSWORD, fromApiOpp, fromApiProject, fromApiSurvey, relTime,
  type ApiAgent, type ApiApproval, type ApiNotification, type ApiSurvey, type ApiSurveyDetail, type Session,
} from './api';

export type ThemePref = 'dark' | 'light' | 'system';

type Notification = (typeof notificationsSeed)[number];
type Approval = Omit<(typeof approvalsSeed)[number], 'projectId' | 'amount' | 'agentId'> & { projectId?: string; amount?: number; agentId?: string; canDecide?: boolean };
type Agent = ApiAgent & { pendingApprovals?: number };
/** Offline: the agent list without any runs (agents only run against the API). */
const offlineAgents = (): Agent[] => agentsSeed.map((a) => ({ ...a, requiresApprovalFor: [...a.requiresApprovalFor], description: '', available: false, unavailable: 'Agents run only when signed in to the API', everyMinutes: 60, settings: {}, nextRunAt: null, lastRunAt: null, runs30d: 0, successRate: null, avgMs: null, produced30d: { notifications: 0, approvals: 0, messages: 0 } }));
export type Mode = 'connecting' | 'live' | 'offline';
export type ResponseRecord = { id: string; surveyId: string; version: number; outcome: Outcome; answers: Answers; at: string; source: 'preview' };
export type AuditEntry = { id: string; at: string; actor: string; action: string; entity: string };

type State = {
  mode: Mode;
  session: Session | null;
  vendors: Vendor[];
  syncing: boolean;
  theme: ThemePref;
  motion: 'full' | 'reduced';
  role: Role;
  projects: Project[];
  opportunities: Opportunity[];
  surveys: SurveySummary[];
  surveyDefs: Record<string, SurveyDef>;
  surveyHistory: Record<string, SurveyDef[]>; // undo stack per survey
  responses: ResponseRecord[];
  agents: Agent[];
  approvals: Approval[];
  notifications: Notification[];
  audit: AuditEntry[];
  assistantOpen: boolean;
  paletteOpen: boolean;
  toasts: { id: string; title: string; tone?: 'ok' | 'warn' | 'info' }[];
};

type Actions = {
  setTheme: (t: ThemePref) => void;
  setMotion: (m: State['motion']) => void;
  setRole: (r: Role) => void;
  setAssistant: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  toast: (title: string, tone?: 'ok' | 'warn' | 'info') => void;
  dismissToast: (id: string) => void;
  moveProject: (id: string, stage: LifecycleStage) => void;
  advanceProject: (id: string) => void;
  moveOpportunity: (id: string, stage: CrmStage, lossReason?: string) => void;
  createRfq: (o: Omit<Opportunity, 'id' | 'stage' | 'probability' | 'created' | 'lastTouch' | 'demo'>) => string;
  updateSurvey: (id: string, next: SurveyDef, label: string) => void;
  undoSurvey: (id: string) => void;
  recordResponse: (surveyId: string, outcome: Outcome, answers: Answers) => void;
  toggleAgent: (id: string) => void;
  decideApproval: (id: string, d: 'approved' | 'rejected') => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  resetDemo: () => void;
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ mfaRequired: boolean; challenge?: string }>;
  verifyMfa: (challenge: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const seed = (): Omit<State, 'theme' | 'motion' | 'role' | 'assistantOpen' | 'paletteOpen' | 'toasts' | 'mode' | 'session' | 'syncing'> => ({
  vendors: [...vendorSeed],
  projects: structuredClone(projectSeed),
  opportunities: structuredClone(oppSeed),
  surveys: structuredClone(surveySeed),
  surveyDefs: { [cloudSurvey.id]: structuredClone(cloudSurvey) },
  surveyHistory: {},
  responses: [],
  agents: offlineAgents(),
  approvals: structuredClone(approvalsSeed),
  notifications: structuredClone(notificationsSeed),
  audit: [],
});

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();

export const useOS = create<State & Actions>()(
  persist(
    (set, get) => {
      const log = (action: string, entity: string) =>
        ({ id: uid(), at: now(), actor: get().role, action, entity }) satisfies AuditEntry;
      const live = () => get().mode === 'live';
      /** Runs an API call after an optimistic local change; on failure, explains and reloads server state. */
      const sync = async <T,>(p: Promise<T>, ok?: (r: T) => void) => {
        try {
          const r = await p;
          ok?.(r);
          return r;
        } catch (e) {
          get().toast(e instanceof ApiError ? e.message : 'Could not reach the API', 'warn');
          void get().refresh();
          return undefined;
        }
      };
      const orNull = <T,>(p: Promise<T>) => p.catch((e) => { if (e instanceof ApiError && e.status === 403) return null; throw e; });
      return {
        mode: 'connecting',
        session: null,
        syncing: false,
        theme: 'dark',
        motion: 'full',
        role: 'executive',
        assistantOpen: false,
        paletteOpen: false,
        toasts: [],
        ...seed(),
        setTheme: (theme) => set({ theme }),
        setMotion: (motion) => set({ motion }),
        setRole: (role) => {
          if (!live()) return set({ role });
          // Live: switching role signs in as that role's demo account (dev convenience, NEXT_PUBLIC_DEMO_LOGINS).
          void (async () => {
            try {
              await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
              await get().signIn(demoEmail(role), DEMO_PASSWORD);
              get().toast(`Signed in as ${get().session?.user.name}`, 'info');
            } catch (e) {
              get().toast(e instanceof ApiError ? e.message : 'Could not switch account', 'warn');
            }
          })();
        },
        setAssistant: (assistantOpen) => set({ assistantOpen }),
        setPalette: (paletteOpen) => set({ paletteOpen }),
        toast: (title, tone = 'ok') => {
          const id = uid();
          set((s) => ({ toasts: [...s.toasts, { id, title, tone }] }));
          setTimeout(() => get().dismissToast(id), 3800);
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        moveProject: (id, stage) => {
          set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? { ...p, stage } : p)),
            audit: [log(`Moved to ${stage}`, id), ...s.audit],
          }));
          if (live()) void sync(api(`/projects/${id}/stage`, { method: 'PATCH', body: { stage } }));
        },
        advanceProject: (id) => {
          const p = get().projects.find((x) => x.id === id);
          if (!p) return;
          const i = lifecycle.indexOf(p.stage);
          if (i < lifecycle.length - 1) get().moveProject(id, lifecycle[i + 1]);
        },
        moveOpportunity: (id, stage, lossReason) => {
          const s = get();
          const o = s.opportunities.find((x) => x.id === id);
          if (!o || o.stage === stage) return;
          if (live()) {
            const prob = { 'New RFQ': 0.1, Qualifying: 0.2, Feasibility: 0.35, 'Quote Sent': 0.5, Negotiation: 0.7, Won: 1, Lost: 0 }[stage];
            set({ opportunities: s.opportunities.map((x) => (x.id === id ? { ...x, stage, probability: prob, lossReason } : x)) });
            void sync(api<{ project: { code: string } | null }>(`/opportunities/${id}/stage`, { method: 'PATCH', body: { stage, lossReason } }), (r) => {
              get().toast(r.project ? `Won. Project ${r.project.code} created in Projects` : `Moved to ${stage}`);
              if (r.project) void get().refresh();
            });
            return;
          }
          const prob = { 'New RFQ': 0.1, Qualifying: 0.2, Feasibility: 0.35, 'Quote Sent': 0.5, Negotiation: 0.7, Won: 1, Lost: 0 }[stage];
          let projects = s.projects;
          let created: Project | undefined;
          // Cross-module: a won opportunity becomes a project in Project Management (no re-entry)
          if (stage === 'Won' && !s.projects.some((p) => p.name === o.title)) {
            const cpiSell = o.value / o.sampleSize;
            created = {
              id: `pr-${uid()}`, code: `SE-26${200 + s.projects.length}`, name: o.title, clientId: o.clientId, type: o.type, countries: o.countries,
              stage: 'Project Setup', owner: 'Priya Nair', start: now().slice(0, 10), deadline: new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10),
              target: o.sampleSize, completes: 0, ir: o.ir, loi: o.loi, dropout: 0, quality: 0, cpiSell: +cpiSell.toFixed(2), cpiCost: +(cpiSell * (1 - o.margin)).toFixed(2),
              budget: Math.round(o.value * (1 - o.margin)), costIncurred: 0, vendors: [], blockers: [],
              quotas: [{ id: 'q0', label: 'Total', target: o.sampleSize, achieved: 0 }], demo: true,
            };
            projects = [created, ...projects];
          }
          set({
            opportunities: s.opportunities.map((x) => (x.id === id ? { ...x, stage, probability: prob, lastTouch: now().slice(0, 10) } : x)),
            projects,
            audit: [log(`Opportunity → ${stage}`, id), ...s.audit],
            notifications: created
              ? [{ id: uid(), title: `Project created: ${created.name}`, body: `${created.code} · from won opportunity · owner Priya Nair`, module: 'projects', time: 'now', read: false, demo: true as const }, ...s.notifications]
              : s.notifications,
          });
          get().toast(created ? `Won. Project ${created.code} created in Projects` : `Moved to ${stage}`);
        },
        createRfq: (o) => {
          const id = `op-${uid()}`;
          if (live()) {
            void sync(
              api<{ id: string }>('/opportunities', { method: 'POST', body: { title: o.title, clientId: o.clientId, audience: o.type, countries: o.countries, sampleSize: o.sampleSize, incidence: o.ir, loi: o.loi, owner: o.owner } }),
              () => { get().toast('RFQ created in Bidding CRM'); void get().refresh(); },
            );
            return id;
          }
          set((s) => ({
            opportunities: [{ ...o, id, stage: 'New RFQ', probability: 0.1, created: now().slice(0, 10), lastTouch: now().slice(0, 10), demo: true }, ...s.opportunities],
            audit: [log('Created RFQ', id), ...s.audit],
          }));
          get().toast('RFQ created in Bidding CRM');
          return id;
        },
        updateSurvey: (id, next, label) => {
          const base = get().surveyDefs[id].version;
          set((s) => ({
            surveyHistory: { ...s.surveyHistory, [id]: [...(s.surveyHistory[id] ?? []), s.surveyDefs[id]].slice(-30) },
            surveyDefs: { ...s.surveyDefs, [id]: { ...next, version: base + 1 } },
            audit: [log(label, id), ...s.audit],
          }));
          // Live: every edit is a new immutable version on the server (optimistic concurrency on baseVersion).
          if (live()) void sync(api(`/surveys/${id}/definition`, { method: 'PUT', body: { definition: { ...next, version: base }, label, baseVersion: base } }));
        },
        undoSurvey: (id) => {
          const h = get().surveyHistory[id] ?? [];
          if (!h.length) return;
          const prev = h[h.length - 1];
          const base = get().surveyDefs[id].version;
          set((s) => ({
            surveyDefs: { ...s.surveyDefs, [id]: live() ? { ...prev, version: base + 1 } : prev },
            surveyHistory: { ...s.surveyHistory, [id]: h.slice(0, -1) },
            audit: [log('Undo', id), ...s.audit],
          }));
          // Versions are immutable, so undo saves the previous definition as a new version.
          if (live()) void sync(api(`/surveys/${id}/definition`, { method: 'PUT', body: { definition: prev, label: `Undo to v${prev.version}`, baseVersion: base } }));
        },
        recordResponse: (surveyId, outcome, answers) =>
          set((s) => {
            const def = s.surveyDefs[surveyId];
            return {
              responses: [{ id: uid(), surveyId, version: def.version, outcome, answers, at: now(), source: 'preview' }, ...s.responses],
              surveyDefs: outcome === 'complete' ? { ...s.surveyDefs, [surveyId]: applyQuotas(def, answers) } : s.surveyDefs,
            };
          }),
        toggleAgent: (id) => {
          const enabled = !get().agents.find((a) => a.id === id)?.enabled;
          set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, enabled } : a)), audit: [log('Toggled agent', id), ...s.audit] }));
          if (live()) void sync(api(`/agents/${id}`, { method: 'PATCH', body: { enabled } }));
        },
        decideApproval: (id, d) => {
          if (live()) {
            void sync(api<{ effect: string }>(`/approvals/${id}/decision`, { method: 'POST', body: { decision: d } }), (r) => {
              get().toast(r.effect, d === 'approved' ? 'ok' : 'warn');
              void get().refresh();
            });
            return;
          }
          set((s) => ({ approvals: s.approvals.map((a) => (a.id === id ? { ...a, status: d } : a)), audit: [log(`Approval ${d}`, id), ...s.audit] }));
          get().toast(d === 'approved' ? 'Approved. Recorded in audit log (no external action in demo)' : 'Rejected and returned to agent', d === 'approved' ? 'ok' : 'warn');
        },
        markAllRead: () => {
          set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
          if (live()) void sync(api('/notifications/read-all', { method: 'POST' }));
        },
        markRead: (id) => {
          if (get().notifications.find((n) => n.id === id)?.read) return;
          set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
          if (live()) void sync(api(`/notifications/${id}/read`, { method: 'POST' }));
        },
        resetDemo: () => {
          if (live()) {
            get().toast('Signed in to the API: reset the database with npm run db:seed', 'info');
            return;
          }
          set({ ...seed() });
          get().toast('Demo data reset', 'info');
        },

        boot: async () => {
          try {
            const session = await api<Session>('/auth/me');
            set({ session, role: session.role });
            await get().refresh();
            set({ mode: 'live' });
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) set({ mode: 'live', session: null });
            else {
              // API unreachable (or failing): fall back to the labelled offline demo.
              if (!(e instanceof ApiUnreachable)) console.warn('API error, using offline demo', e);
              setRegistries(null, null);
              set({ mode: 'offline', session: null });
            }
          }
        },

        /** Reloads every record the signed-in role may see. Modules the role cannot open are skipped. */
        refresh: async () => {
          const role = get().session?.role;
          if (!role) return;
          set({ syncing: true });
          const has = (m: Parameters<typeof access>[1]) => access(role, m) !== 'none';
          try {
            const [projects, opportunities, vendors, surveys, approvals, notifications, agents, clients] = await Promise.all([
              has('projects') ? orNull(apiAll<Parameters<typeof fromApiProject>[0]>('/projects')) : null,
              has('crm') ? orNull(apiAll<Parameters<typeof fromApiOpp>[0]>('/opportunities')) : null,
              has('marketplace') ? orNull(apiAll<Vendor>('/vendors')) : null,
              has('survey-studio') ? orNull(apiAll<ApiSurvey>('/surveys')) : null,
              orNull(api<ApiApproval[]>('/approvals')),
              orNull(api<ApiNotification[]>('/notifications')),
              has('automation') ? orNull(api<ApiAgent[]>('/agents')) : null,
              has('projects') ? orNull(apiAll<{ id: string; name: string; sector: string | null }>('/clients')) : null,
            ]);
            setRegistries(vendors ?? [], clients ?? []);
            const defs: Record<string, SurveyDef> = {};
            for (const sv of (surveys ?? []).filter((x) => x.hasDefinition)) {
              const d = await orNull(api<ApiSurveyDetail>(`/surveys/${sv.id}`));
              if (d?.definition) defs[sv.id] = d.definition;
            }
            const pendingByAgent = new Map<string, number>();
            for (const a of approvals ?? []) if (a.agentId && a.status === 'pending') pendingByAgent.set(a.agentId, (pendingByAgent.get(a.agentId) ?? 0) + 1);
            set({
              projects: (projects ?? []).map(fromApiProject),
              opportunities: (opportunities ?? []).map(fromApiOpp),
              vendors: vendors ?? [],
              surveys: (surveys ?? []).map(fromApiSurvey),
              surveyDefs: defs,
              approvals: (approvals ?? []).map((a) => ({ id: a.id, agentId: a.agentId ?? undefined, kind: a.kind, title: a.title, projectId: a.projectId ?? undefined, amount: a.amount ?? undefined, requested: a.createdAt, status: a.status, canDecide: a.canDecide, demo: true as const })),
              notifications: (notifications ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, module: n.module, time: relTime(n.createdAt), read: n.read, demo: true as const })),
              agents: (agents ?? []).map((a) => ({ ...a, pendingApprovals: pendingByAgent.get(a.id) ?? 0 })),
            });
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) set({ session: null });
            else get().toast('Could not load records from the API', 'warn');
          } finally {
            set({ syncing: false });
          }
        },

        signIn: async (email, password) => {
          const r = await api<{ mfaRequired: boolean; challenge?: string }>('/auth/login', { method: 'POST', body: { email, password } });
          if (r.mfaRequired) return r;
          await get().boot();
          return { mfaRequired: false };
        },
        verifyMfa: async (challenge, code) => {
          await api('/auth/mfa/verify', { method: 'POST', body: { challenge, code } });
          await get().boot();
        },
        signOut: async () => {
          await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
          // Drop the previous user's records from memory and storage.
          setRegistries([], []);
          set({ session: null, ...seed(), projects: [], opportunities: [], vendors: [], surveys: [], surveyDefs: {}, approvals: [], notifications: [], agents: [] });
        },
      };
    },
    {
      name: 'sampledge-os-demo-v1',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // Only preferences persist while signed in; server records are never cached in localStorage.
      // In offline mode the demo records persist as in Phase 2.
      partialize: (s) => {
        const { toasts, assistantOpen, paletteOpen, mode, session, syncing, ...rest } = s;
        void toasts; void assistantOpen; void paletteOpen; void session; void syncing;
        return mode === 'offline' ? rest : { theme: s.theme, motion: s.motion };
      },
      migrate: (persisted) => persisted as never,
    },
  ),
);


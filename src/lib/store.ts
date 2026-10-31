'use client';
/**
 * Phase 2 application state. A single client-side store standing in for the Phase 3 API.
 * Every module reads the same records (projects, opportunities, vendors, surveys), so an
 * action in one module (e.g. winning a CRM deal) shows up everywhere without re-entry.
 * Persisted to localStorage; "Reset demo data" restores the seed.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  approvals as approvalsSeed, agents as agentsSeed, notificationsSeed, opportunities as oppSeed, projects as projectSeed,
  surveys as surveySeed, lifecycle, type CrmStage, type LifecycleStage, type Opportunity, type Project, type SurveySummary,
} from './demo/data';
import { cloudSurvey } from './survey/demo-survey';
import { applyQuotas, type Answers, type Outcome, type SurveyDef } from './survey/engine';
import type { Role } from './roles';

export type ThemePref = 'dark' | 'light' | 'system';

type Notification = (typeof notificationsSeed)[number];
type Approval = (typeof approvalsSeed)[number];
type Agent = (typeof agentsSeed)[number];
export type ResponseRecord = { id: string; surveyId: string; version: number; outcome: Outcome; answers: Answers; at: string; source: 'preview' };
export type AuditEntry = { id: string; at: string; actor: string; action: string; entity: string };

type State = {
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
  moveOpportunity: (id: string, stage: CrmStage) => void;
  createRfq: (o: Omit<Opportunity, 'id' | 'stage' | 'probability' | 'created' | 'lastTouch' | 'demo'>) => string;
  updateSurvey: (id: string, next: SurveyDef, label: string) => void;
  undoSurvey: (id: string) => void;
  recordResponse: (surveyId: string, outcome: Outcome, answers: Answers) => void;
  toggleAgent: (id: string) => void;
  decideApproval: (id: string, d: 'approved' | 'rejected') => void;
  markAllRead: () => void;
  resetDemo: () => void;
};

const seed = (): Omit<State, 'theme' | 'motion' | 'role' | 'assistantOpen' | 'paletteOpen' | 'toasts'> => ({
  projects: structuredClone(projectSeed),
  opportunities: structuredClone(oppSeed),
  surveys: structuredClone(surveySeed),
  surveyDefs: { [cloudSurvey.id]: structuredClone(cloudSurvey) },
  surveyHistory: {},
  responses: [],
  agents: structuredClone(agentsSeed),
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
      return {
        theme: 'dark',
        motion: 'full',
        role: 'executive',
        assistantOpen: false,
        paletteOpen: false,
        toasts: [],
        ...seed(),
        setTheme: (theme) => set({ theme }),
        setMotion: (motion) => set({ motion }),
        setRole: (role) => set({ role }),
        setAssistant: (assistantOpen) => set({ assistantOpen }),
        setPalette: (paletteOpen) => set({ paletteOpen }),
        toast: (title, tone = 'ok') => {
          const id = uid();
          set((s) => ({ toasts: [...s.toasts, { id, title, tone }] }));
          setTimeout(() => get().dismissToast(id), 3800);
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        moveProject: (id, stage) =>
          set((s) => ({
            projects: s.projects.map((p) => (p.id === id ? { ...p, stage } : p)),
            audit: [log(`Moved to ${stage}`, id), ...s.audit],
          })),
        advanceProject: (id) => {
          const p = get().projects.find((x) => x.id === id);
          if (!p) return;
          const i = lifecycle.indexOf(p.stage);
          if (i < lifecycle.length - 1) get().moveProject(id, lifecycle[i + 1]);
        },
        moveOpportunity: (id, stage) => {
          const s = get();
          const o = s.opportunities.find((x) => x.id === id);
          if (!o || o.stage === stage) return;
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
          set((s) => ({
            opportunities: [{ ...o, id, stage: 'New RFQ', probability: 0.1, created: now().slice(0, 10), lastTouch: now().slice(0, 10), demo: true }, ...s.opportunities],
            audit: [log('Created RFQ', id), ...s.audit],
          }));
          get().toast('RFQ created in Bidding CRM');
          return id;
        },
        updateSurvey: (id, next, label) =>
          set((s) => ({
            surveyHistory: { ...s.surveyHistory, [id]: [...(s.surveyHistory[id] ?? []), s.surveyDefs[id]].slice(-30) },
            surveyDefs: { ...s.surveyDefs, [id]: { ...next, version: s.surveyDefs[id].version + 1 } },
            audit: [log(label, id), ...s.audit],
          })),
        undoSurvey: (id) =>
          set((s) => {
            const h = s.surveyHistory[id] ?? [];
            if (!h.length) return s;
            return { surveyDefs: { ...s.surveyDefs, [id]: h[h.length - 1] }, surveyHistory: { ...s.surveyHistory, [id]: h.slice(0, -1) }, audit: [log('Undo', id), ...s.audit] };
          }),
        recordResponse: (surveyId, outcome, answers) =>
          set((s) => {
            const def = s.surveyDefs[surveyId];
            return {
              responses: [{ id: uid(), surveyId, version: def.version, outcome, answers, at: now(), source: 'preview' }, ...s.responses],
              surveyDefs: outcome === 'complete' ? { ...s.surveyDefs, [surveyId]: applyQuotas(def, answers) } : s.surveyDefs,
            };
          }),
        toggleAgent: (id) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)), audit: [log('Toggled agent', id), ...s.audit] })),
        decideApproval: (id, d) => {
          set((s) => ({ approvals: s.approvals.map((a) => (a.id === id ? { ...a, status: d } : a)), audit: [log(`Approval ${d}`, id), ...s.audit] }));
          get().toast(d === 'approved' ? 'Approved. Recorded in audit log (no external action in demo)' : 'Rejected and returned to agent', d === 'approved' ? 'ok' : 'warn');
        },
        markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
        resetDemo: () => {
          set({ ...seed() });
          get().toast('Demo data reset', 'info');
        },
      };
    },
    {
      name: 'sampledge-os-demo-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        const { toasts, assistantOpen, paletteOpen, ...rest } = s;
        void toasts; void assistantOpen; void paletteOpen;
        return rest;
      },
    },
  ),
);


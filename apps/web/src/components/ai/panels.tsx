'use client';
/**
 * Screens for the AI gateway: a project status summary (drawer) and the gateway panel on the
 * Automation page. Both need the API: the gateway runs server-side so keys and data never touch
 * the browser. Offline they say so rather than imitate a model.
 */
import { useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { access } from '@/lib/core';
import { useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtMoney, fmtNum } from '@/lib/utils';
import { Badge, Bar, Button, EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

type AiRun<T> = { data: T; provider: 'rules' | 'anthropic'; model: string | null; status: string; note: string; costUsd: number };
type Summary = { headline: string; bullets: string[]; risks: { level: 'high' | 'medium' | 'low'; text: string }[]; nextSteps: string[] };
export type AiStatus = { provider: 'rules' | 'anthropic'; model: string | null; connected: boolean; note: string | null; monthSpendUsd: number; monthCalls: number; capUsd: number; tasks: { name: string; version: number; description: string }[] };
type AiCall = { id: string; task: string; provider: string; model: string | null; status: string; inputTokens: number; outputTokens: number; costUsd: number; ms: number; createdAt: string; error: string | null };

const riskTone = { high: 'danger', medium: 'orange', low: 'neutral' } as const;

export function ProjectAiSummary({ projectId }: { projectId: string }) {
  const live = useOS((s) => s.mode === 'live' && !!s.session);
  const [r, setR] = useState<AiRun<Summary> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!live) return null;
  const run = async () => {
    setBusy(true); setErr(null);
    try { setR(await api<AiRun<Summary>>(`/ai/projects/${projectId}/summary`)); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not summarise'); } finally { setBusy(false); }
  };
  return (
    <div className="panel-solid p-3">
      <div className="flex items-center gap-2"><Sparkles size={14} className="text-cyan" /><span className="text-[12.5px] font-semibold">Status summary</span><span className="flex-1" />
        <Button size="sm" variant="subtle" onClick={run} disabled={busy}>{busy ? 'Summarising…' : r ? 'Refresh' : 'Summarise'}</Button></div>
      {err && <p className="mt-2 text-2xs text-danger">{err}</p>}
      {r && (
        <div className="mt-2 space-y-2 text-[12.5px]">
          <div className="font-medium">{r.data.headline}</div>
          <ul className="list-disc space-y-0.5 pl-4 text-ink-2">{r.data.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          {r.data.risks.length > 0 && <div className="flex flex-wrap gap-1">{r.data.risks.map((x) => <Badge key={x.text} tone={riskTone[x.level]}>{x.level}: {x.text}</Badge>)}</div>}
          {r.data.nextSteps.length > 0 && <div className="text-2xs text-ink-3">Next: {r.data.nextSteps.join(' · ')}</div>}
          <div className="text-2xs text-ink-3">{r.note}</div>
        </div>
      )}
    </div>
  );
}

/** Header badge: which provider answers AI tasks right now. */
export function AiProviderBadge() {
  const st = useLive<AiStatus>('/ai/status');
  if (!st.live) return <Badge tone="orange">Offline demo: no AI provider</Badge>;
  if (!st.data) return null;
  return st.data.connected ? <Badge tone="emerald">AI: {st.data.model}</Badge> : <Badge tone="orange">AI: rule-based (no model connected)</Badge>;
}

export function AiGatewayPanel() {
  const role = useOS((s) => s.role);
  const st = useLive<AiStatus>('/ai/status');
  const admin = access(role, 'admin') !== 'none';
  const usage = useLive<AiCall[]>(admin ? '/ai/usage?take=12' : null);
  if (!st.live) return (
    <Panel><PanelHeader eyebrow="AI gateway" title="Model provider" /><EmptyState icon={<Bot size={18} />} title="Sign in to the live workspace" body="AI tasks run on the API so keys and data stay server-side. The agent figures on this page are simulated." /></Panel>
  );
  const s = st.data;
  return (
    <Panel>
      <PanelHeader eyebrow="AI gateway" title={s ? (s.connected ? `Connected: ${s.model}` : 'Rule-based mode') : 'Loading…'} info="Every AI task has a rule-based implementation. A model is used only when AI_PROVIDER=anthropic and an API key are configured on the server. Model output is checked against the task's schema and falls back to the rules on any error, refusal or when the monthly cap is reached. Outputs are drafts; approvals still apply." />
      {s && (
        <div className="space-y-4">
          {s.note && <p className="rounded-lg bg-orange/10 px-3 py-1.5 text-2xs text-orange">{s.note}</p>}
          <div>
            <div className="mb-1 flex justify-between text-[12px]"><span>Spend this month</span><span className="num">{fmtMoney(s.monthSpendUsd)} of {fmtMoney(s.capUsd)} · {fmtNum(s.monthCalls)} calls</span></div>
            <Bar value={s.capUsd ? Math.min(1, s.monthSpendUsd / s.capUsd) : 0} tone={s.monthSpendUsd >= s.capUsd ? 'danger' : 'purple'} />
          </div>
          <div className="space-y-1">{s.tasks.map((t) => <div key={t.name} className="flex items-center gap-2 text-[12px]"><Badge tone="blue">{t.name} v{t.version}</Badge><span className="text-ink-2">{t.description}</span></div>)}</div>
          {admin && (
            <div>
              <div className="eyebrow mb-1">Recent calls</div>
              {usage.data?.length ? (
                <div className="space-y-1">{usage.data.map((c) => (
                  <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_70px_70px_60px] gap-2 text-[11.5px]">
                    <span className="truncate">{c.task} <span className="text-ink-3">· {c.provider}</span></span>
                    <span className={cn('text-right', c.status === 'ok' ? 'text-emerald' : 'text-orange')}>{c.status}</span>
                    <span className="num text-right text-ink-3">{fmtNum(c.inputTokens + c.outputTokens)} tok</span>
                    <span className="num text-right">${c.costUsd.toFixed(3)}</span>
                  </div>
                ))}</div>
              ) : <p className="text-2xs text-ink-3">No AI calls yet this month.</p>}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

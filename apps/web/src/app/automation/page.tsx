'use client';
import { motion } from 'motion/react';
import { Check, Play, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { access, can } from '@/lib/core';
import { api, type ApiAgent } from '@/lib/api';
import { act, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { cn, fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';
import { AiEvalPanel, AiGatewayPanel, AiProviderBadge } from '@/components/ai/panels';

const policies = ['Sending binding quotations', 'Purchasing sample', 'Issuing payments', 'Rejecting respondents in consequential cases', 'Publishing surveys', 'Releasing sensitive datasets', 'Deleting records', 'Sending high-volume communications', 'Granting admin access', 'Launching client studies'];
const approverFor: Record<string, Parameters<typeof can>[1]> = { 'Purchasing sample': 'approve:purchase', 'Launching client studies': 'approve:purchase', 'Sending binding quotations': 'approve:quotes', 'Issuing payments': 'approve:payments', 'Publishing surveys': 'approve:publish' };

type Run = { id: string; agentId: string; agent: { name: string }; trigger: 'schedule' | 'manual'; triggeredBy: string | null; status: 'succeeded' | 'failed'; startedAt: string; ms: number; summary: string; examined: number; notifications: number; approvals: number; messages: number; error: string | null };
type Daily = { day: string; succeeded: number; failed: number }[];

/** Labels for agent settings (the API validates the values). */
const settingLabels: Record<string, { label: string; step?: number; hint?: string }> = {
  minFlags: { label: 'Quality flags needed', hint: 'Interviews with at least this many flags are put up for rejection' },
  quotaAlert: { label: 'Quota alert at (share full)', step: 0.05 },
  paceGap: { label: 'Behind-pace margin', step: 0.05, hint: 'How far completes may trail elapsed field time' },
  staleDays: { label: 'Follow up after (days)' },
};
const everyLabel = (m: number) => (m % 10080 === 0 ? `every ${m / 10080 === 1 ? '' : `${m / 10080} `}week${m / 10080 === 1 ? '' : 's'}` : m % 1440 === 0 ? `every ${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `every ${m / 60} h` : `every ${m} min`);
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

function AgentSettings({ agent, canEdit, onChanged }: { agent: ApiAgent; canEdit: boolean; onChanged: () => void }) {
  const [every, setEvery] = useState(agent.everyMinutes);
  const [settings, setSettings] = useState<Record<string, number>>(agent.settings);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    await act(() => api(`/agents/${agent.id}`, { method: 'PATCH', body: { everyMinutes: every, ...(Object.keys(settings).length ? { settings } : {}) } }), 'Agent settings saved');
    setBusy(false); onChanged();
  };
  const run = async () => {
    setBusy(true);
    await act(() => api<Run>(`/agents/${agent.id}/run`, { method: 'POST' }), (r) => (r.status === 'succeeded' ? `${agent.name}: ${r.summary}` : `${agent.name} failed: ${r.error ?? r.summary}`));
    setBusy(false); onChanged();
  };
  return (
    <div className="space-y-3 text-[12.5px]">
      <p className="text-ink-2">{agent.description}</p>
      {!agent.available ? <div className="panel-solid p-3 text-2xs text-ink-3">{agent.unavailable}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Schedule (minutes)" hint={everyLabel(every)}><input type="number" min={5} className={inputCls} value={every} disabled={!canEdit} onChange={(e) => setEvery(+e.target.value)} /></Field>
            {Object.entries(settings).map(([k, v]) => (
              <Field key={k} label={settingLabels[k]?.label ?? k} hint={settingLabels[k]?.hint}><input type="number" step={settingLabels[k]?.step ?? 1} className={inputCls} value={v} disabled={!canEdit} onChange={(e) => setSettings({ ...settings, [k]: +e.target.value })} /></Field>
            ))}
          </div>
          <div className="text-2xs text-ink-3">{agent.enabled ? (agent.nextRunAt ? `Next run ${new Date(agent.nextRunAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Runs at the next worker check') : 'Paused: turn it on to run on schedule'}{agent.lastRunAt ? ` · last ran ${ago(agent.lastRunAt)}` : ' · has not run yet'}</div>
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={save}>Save settings</Button>
              <Button size="sm" disabled={busy} onClick={run}><Play size={12} /> Run now</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AutomationPage() {
  const s = useOS();
  const canEdit = access(s.role, 'automation') === 'full' && can(s.role, 'edit:automations');
  const agents = useLive<ApiAgent[]>('/agents', [s.approvals]);
  const runs = useLive<Run[]>('/agents/runs', [agents.data]);
  const daily = useLive<Daily>('/agents/daily', [agents.data]);
  const list = agents.data ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find((a) => a.id === selId) ?? list.find((a) => a.available) ?? null;
  const pending = s.approvals.filter((a) => a.status === 'pending');
  const reload = () => { void agents.reload(); void s.refresh(); };

  const totals = useMemo(() => {
    const runs30 = list.reduce((n, a) => n + a.runs30d, 0);
    const failed = list.reduce((n, a) => n + (a.successRate == null ? 0 : Math.round(a.runs30d * (1 - a.successRate))), 0);
    const ms = list.filter((a) => a.avgMs != null);
    return {
      runs30, failed,
      avgMs: ms.length ? ms.reduce((n, a) => n + (a.avgMs ?? 0) * a.runs30d, 0) / Math.max(1, ms.reduce((n, a) => n + a.runs30d, 0)) : null,
      produced: list.reduce((n, a) => n + a.produced30d.notifications + a.produced30d.approvals + a.produced30d.messages, 0),
    };
  }, [list]);

  const toggle = async (a: ApiAgent) => {
    await act(() => api(`/agents/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } }), a.enabled ? `${a.name} paused` : `${a.name} turned on; it runs at the next worker check`);
    reload();
  };

  return (
    <div>
      <PageHeader eyebrow="AI Automation Command Center" title="Agents, runs & approvals" subtitle="Scheduled agents that watch your records, raise alerts and open approvals. Consequential actions always wait for a person."
        actions={<AiProviderBadge />} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Agents switched on" value={list.filter((a) => a.enabled).length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" status={{ tone: 'ok', text: `${list.filter((a) => a.available).length} can run here` }} />
        <KpiCard label="Runs (30d)" value={totals.runs30} format={(n) => fmtNum(n)} color="rgb(var(--cyan))" />
        <KpiCard label="Failed runs (30d)" value={totals.failed} format={(n) => fmtNum(n)} color="rgb(var(--danger))" />
        <KpiCard label="Pending approvals" value={pending.length} format={(n) => fmtNum(n)} status={{ tone: pending.length ? 'warn' : 'ok', text: 'Human-in-the-loop' }} color="rgb(var(--orange))" />
        <KpiCard label="Avg run time" value={totals.avgMs ?? 0} format={(n) => (totals.avgMs == null ? '—' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`)} />
        <KpiCard label="Alerts, approvals, messages (30d)" value={totals.produced} format={(n) => fmtNum(n)} color="rgb(var(--emerald))" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel>
          <PanelHeader eyebrow="Agent settings" title={sel ? sel.name : 'Select an agent'} actions={sel && <Badge tone={sel.enabled ? 'emerald' : 'neutral'} dot>{sel.enabled ? 'On' : sel.available ? 'Paused' : 'Not automated'}</Badge>} />
          {sel ? <AgentSettings key={`${sel.id}-${sel.everyMinutes}-${JSON.stringify(sel.settings)}`} agent={sel} canEdit={canEdit} onChanged={reload} /> : <EmptyState title={agents.error ?? 'Loading agents…'} />}
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Approval queue" title={`Waiting on a human (${pending.length})`} actions={<ShieldCheck size={16} className="text-emerald" />} />
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {s.approvals.map((a) => {
              const perm = approverFor[a.kind];
              // Live: the server says whether this user may decide (role permission + not the requester).
              const allowed = a.canDecide ?? (perm ? can(s.role, perm) : ['platform_admin', 'executive', 'project_manager', 'panel_manager', 'data_processing'].includes(s.role));
              return (
                <motion.div layout key={a.id} className={cn('panel-solid p-3 text-[12.5px]', a.status !== 'pending' && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2"><Badge tone="orange">{a.kind}</Badge>{a.status !== 'pending' && <Badge tone={a.status === 'approved' ? 'emerald' : 'danger'}>{a.status}</Badge>}</div>
                  <div className="mt-1.5 font-medium">{a.title}</div>
                  <div className="text-2xs text-ink-3">{s.agents.find((g) => g.id === a.agentId)?.name ?? 'Requested by a team member'}{a.amount ? ` · ${fmtMoney(a.amount, false)}` : ''}</div>
                  {a.status === 'pending' && (
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" variant="primary" disabled={!allowed} onClick={() => s.decideApproval(a.id, 'approved')}><Check size={12} /> Approve</Button>
                      <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => s.decideApproval(a.id, 'rejected')}><X size={12} /> Reject</Button>
                      {!allowed && <span className="text-2xs text-ink-3">Your role cannot approve this</span>}
                    </div>
                  )}
                </motion.div>
              );
            })}
            {!s.approvals.length && <EmptyState title="Queue is empty" />}
          </div>
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelHeader eyebrow="Agents" title="Specialised agents" actions={<span className="text-2xs text-ink-3">{canEdit ? 'Select an agent to configure it; the switch turns it on or off' : 'Read only for your role'}</span>} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {list.map((a, i) => (
            <motion.div key={a.id} role="button" tabIndex={0} onClick={() => setSelId(a.id)} onKeyDown={(e) => e.key === 'Enter' && setSelId(a.id)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className={cn('panel-solid cursor-pointer p-4 text-left', !a.enabled && 'opacity-70', sel?.id === a.id && 'ring-1 ring-inset ring-cyan/50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[13px] font-semibold leading-snug">{a.name}</div>
                <button role="switch" aria-checked={a.enabled} aria-label={`Toggle ${a.name}`} disabled={!canEdit || !a.available} title={a.unavailable ?? undefined} onClick={(e) => { e.stopPropagation(); void toggle(a); }} className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40', a.enabled ? 'bg-emerald' : 'bg-ink-3/30')}>
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', a.enabled ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </div>
              {a.available ? (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                    <div><div className="text-ink-3">Runs 30d</div><div className="num font-semibold">{fmtNum(a.runs30d)}</div></div>
                    <div><div className="text-ink-3">Success</div><div className="num font-semibold">{a.successRate == null ? '—' : fmtPct(a.successRate)}</div></div>
                    <div><div className="text-ink-3">Output</div><div className="num font-semibold">{fmtNum(a.produced30d.notifications + a.produced30d.approvals + a.produced30d.messages)}</div></div>
                  </div>
                  <div className="mt-2 text-2xs text-ink-3">{everyLabel(a.everyMinutes)}{a.lastRunAt ? ` · last ran ${ago(a.lastRunAt)}` : ' · not run yet'}</div>
                </>
              ) : <div className="mt-2 text-2xs text-ink-3">Not automated here</div>}
              {a.requiresApprovalFor.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{a.requiresApprovalFor.map((p) => <Badge key={p} tone="emerald">approval: {p.toLowerCase()}</Badge>)}</div>}
            </motion.div>
          ))}
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader eyebrow="Reliability" title="Agent runs per day (14 days)" />
          {!daily.data?.some((d) => d.succeeded || d.failed) ? <EmptyState title="No runs yet" body="Turn an agent on, or use Run now, and its runs are counted here." /> : (
            <EChart ariaLabel="Agent runs per day" height={240} deps={[daily.data]} option={(t) => ({
              tooltip: { trigger: 'axis' }, legend: { right: 0 },
              xAxis: { type: 'category', data: daily.data!.map((d) => new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })), ...axis(t), splitLine: { show: false } }, yAxis: { type: 'value', minInterval: 1, ...axis(t) },
              series: [{ name: 'Succeeded', type: 'bar', stack: 'x', barWidth: 12, data: daily.data!.map((d) => d.succeeded), itemStyle: { color: palette.cyan } }, { name: 'Failed', type: 'bar', stack: 'x', data: daily.data!.map((d) => d.failed), itemStyle: { color: palette.danger, borderRadius: [3, 3, 0, 0] } }],
            })} />
          )}
        </Panel>
        <Panel className="p-0">
          <div className="p-5 pb-2"><PanelHeader eyebrow="Run log" title="Recent runs" className="mb-0" /></div>
          <div className="max-h-[260px] overflow-y-auto">
            {!runs.data?.length ? <div className="px-5 pb-5"><EmptyState title="No runs recorded" /></div> : (
              <table className="w-full text-left text-[12px]">
                <tbody>{runs.data.map((r) => (
                  <tr key={r.id} className="border-t hairline align-top">
                    <td className="px-5 py-2"><div className="font-medium">{r.agent.name}</div><div className="text-2xs text-ink-3">{r.status === 'failed' ? r.error : r.summary}</div></td>
                    <td className="py-2"><Badge tone={r.status === 'succeeded' ? 'emerald' : 'danger'} dot>{r.status === 'succeeded' ? 'Succeeded' : 'Failed'}</Badge></td>
                    <td className="num whitespace-nowrap py-2 pr-5 text-right text-2xs text-ink-3">{r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`} · {ago(r.startedAt)}<div>{r.trigger === 'manual' ? `by ${r.triggeredBy}` : 'scheduled'}</div></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="AI safety" title="Always requires a human" />
          <ul className="space-y-1.5 text-[12.5px]">{policies.map((p) => <li key={p} className="flex items-center gap-2"><ShieldCheck size={13} className="shrink-0 text-emerald" />{p}</li>)}</ul>
          <p className="mt-3 text-2xs text-ink-3">Enforced by the API: agents and people can only request these actions; a different person with the right permission decides.</p>
        </Panel>
      </div>

      <div className="mt-6"><AiGatewayPanel /></div>
      <div className="mt-6"><AiEvalPanel /></div>
    </div>
  );
}

'use client';
import { motion } from 'motion/react';
import { Check, ShieldCheck, X } from 'lucide-react';
import { useMemo } from 'react';
import { agents as agentSeed } from '@/lib/core';
import { access, can } from '@/lib/core';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { avg, cn, fmtMoney, fmtNum, fmtPct, rng, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Bar, Button, DemoBadge, EmptyState, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';
import { WorkflowEditor } from '@/components/flow/workflow-editor';

const policies = ['Sending binding quotations', 'Purchasing sample', 'Issuing payments', 'Rejecting respondents in consequential cases', 'Publishing surveys', 'Releasing sensitive datasets', 'Deleting records', 'Sending high-volume communications'];
const approverFor: Record<string, Parameters<typeof can>[1]> = { 'Purchasing sample': 'approve:purchase', 'Sending binding quotations': 'approve:quotes', 'Issuing payments': 'approve:payments', 'Publishing surveys': 'approve:publish' };

export default function AutomationPage() {
  const s = useOS();
  const canEdit = access(s.role, 'automation') === 'full';
  const execs = useMemo(() => {
    const r = rng(77);
    return Array.from({ length: 14 }, (_, i) => {
      const a = agentSeed[Math.floor(r() * agentSeed.length)];
      const st = r() > 0.9 ? 'Failed' : r() > 0.82 ? 'Awaiting approval' : 'Succeeded';
      return { id: `ex-${9120 - i}`, agent: a.name, status: st, ms: Math.round(800 + r() * 40000), at: `${Math.floor(i * 0.7)}h ${Math.floor(r() * 59)}m ago`, tokens: Math.round(2000 + r() * 30000) };
    });
  }, []);
  const pending = s.approvals.filter((a) => a.status === 'pending');
  const daily = useMemo(() => { const r = rng(5); return Array.from({ length: 14 }, (_, i) => ({ ok: Math.round(160 + i * 6 + r() * 40), fail: Math.round(r() * 9) })); }, []);

  return (
    <div>
      <PageHeader eyebrow="AI Automation Command Center" title="Agents, workflows & approvals" subtitle="Twelve specialised agents with cost caps, permission scopes and mandatory human approval for consequential actions."
        actions={<><DemoBadge label="Simulated executions" /><Badge tone="orange">No model provider connected</Badge></>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Active automations" value={s.agents.filter((a) => a.enabled).length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="Scheduled workflows" value={23} format={(n) => fmtNum(n)} />
        <KpiCard label="Executions (30d)" value={sum(s.agents.map((a) => a.runs30d))} format={(n) => fmtNum(n)} delta={0.14} color="rgb(var(--cyan))" />
        <KpiCard label="Failed (30d)" value={Math.round(sum(s.agents.map((a) => a.runs30d * (1 - a.successRate))))} format={(n) => fmtNum(n)} deltaGoodWhen="down" delta={-0.08} color="rgb(var(--danger))" />
        <KpiCard label="Pending approvals" value={pending.length} format={(n) => fmtNum(n)} status={{ tone: pending.length ? 'warn' : 'ok', text: 'Human-in-the-loop' }} color="rgb(var(--orange))" />
        <KpiCard label="AI spend (30d)" value={sum(s.agents.map((a) => a.costUsd30d))} format={(n) => fmtMoney(n)} status={{ tone: 'ok', text: `Cap ${fmtMoney(sum(s.agents.map((a) => a.costCapUsd)))}` }} color="rgb(var(--purple))" />
        <KpiCard label="Avg processing time" value={avg(s.agents.map((a) => a.avgSeconds))} format={(n) => `${n.toFixed(0)}s`} />
        <KpiCard label="Est. time saved" value={sum(s.agents.map((a) => a.minutesSaved)) / 60} format={(n) => `${fmtNum(n)} h`} delta={0.21} color="rgb(var(--emerald))" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel>
          <PanelHeader eyebrow="Workflow editor" title="Low-incidence rescue · v7" actions={!canEdit && <Badge>Read only</Badge>} />
          <WorkflowEditor />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Approval queue" title={`Waiting on a human (${pending.length})`} actions={<ShieldCheck size={16} className="text-emerald" />} />
          <div className="space-y-2">
            {s.approvals.map((a) => {
              const perm = approverFor[a.kind];
              // Live: the server says whether this user may decide (role permission + not the requester).
              const allowed = a.canDecide ?? (perm ? can(s.role, perm) : ['platform_admin', 'executive', 'project_manager', 'panel_manager', 'data_processing'].includes(s.role));
              return (
                <motion.div layout key={a.id} className={cn('panel-solid p-3 text-[12.5px]', a.status !== 'pending' && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2"><Badge tone="orange">{a.kind}</Badge>{a.status !== 'pending' && <Badge tone={a.status === 'approved' ? 'emerald' : 'danger'}>{a.status}</Badge>}</div>
                  <div className="mt-1.5 font-medium">{a.title}</div>
                  <div className="text-2xs text-ink-3">{agentSeed.find((g) => g.id === a.agentId)?.name ?? 'Requested by a team member'}{a.amount ? ` · ${fmtMoney(a.amount, false)}` : ''}</div>
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
        <PanelHeader eyebrow="Agents" title="Specialised agents" actions={<span className="text-2xs text-ink-3">{canEdit ? 'Toggle to pause an agent' : 'Read only for your role'}</span>} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {s.agents.map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={cn('panel-solid p-4', !a.enabled && 'opacity-55')}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[13px] font-semibold leading-snug">{a.name}</div>
                <button role="switch" aria-checked={a.enabled} aria-label={`Toggle ${a.name}`} disabled={!canEdit} onClick={() => s.toggleAgent(a.id)} className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50', a.enabled ? 'bg-emerald' : 'bg-ink-3/30')}>
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', a.enabled ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                <div><div className="text-ink-3">Runs</div><div className="num font-semibold">{fmtNum(a.runs30d)}</div></div>
                <div><div className="text-ink-3">Success</div><div className="num font-semibold">{fmtPct(a.successRate)}</div></div>
                <div><div className="text-ink-3">Saved</div><div className="num font-semibold">{Math.round(a.minutesSaved / 60)}h</div></div>
              </div>
              <div className="mt-2 text-2xs text-ink-3">Spend {fmtMoney(a.costUsd30d, false)} of {fmtMoney(a.costCapUsd, false)} cap</div>
              <Bar value={a.costUsd30d / a.costCapUsd} tone={a.costUsd30d / a.costCapUsd > 0.8 ? 'orange' : 'purple'} className="mt-1" />
              {a.requiresApprovalFor.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{a.requiresApprovalFor.map((p) => <Badge key={p} tone="emerald">approval: {p.toLowerCase()}</Badge>)}</div>}
            </motion.div>
          ))}
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader eyebrow="Reliability" title="Executions per day" />
          <EChart ariaLabel="Executions per day" height={240} deps={[]} option={(t) => ({
            tooltip: { trigger: 'axis' }, legend: { right: 0 },
            xAxis: { type: 'category', data: daily.map((_, i) => `D-${13 - i}`), ...axis(t), splitLine: { show: false } }, yAxis: { type: 'value', ...axis(t) },
            series: [{ name: 'Succeeded', type: 'bar', stack: 'x', barWidth: 12, data: daily.map((d) => d.ok), itemStyle: { color: palette.cyan } }, { name: 'Failed', type: 'bar', stack: 'x', data: daily.map((d) => d.fail), itemStyle: { color: palette.danger, borderRadius: [3, 3, 0, 0] } }],
          })} />
        </Panel>
        <Panel className="p-0">
          <div className="p-5 pb-2"><PanelHeader eyebrow="Execution log" title="Recent runs" className="mb-0" /></div>
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full text-left text-[12px]">
              <tbody>{execs.map((e) => (
                <tr key={e.id} className="border-t hairline"><td className="px-5 py-2 font-mono text-2xs text-ink-3">{e.id}</td><td className="py-2">{e.agent}</td><td className="py-2"><Badge tone={e.status === 'Succeeded' ? 'emerald' : e.status === 'Failed' ? 'danger' : 'orange'} dot>{e.status}</Badge></td><td className="num py-2 pr-5 text-right text-2xs text-ink-3">{(e.ms / 1000).toFixed(1)}s · {e.at}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="AI safety" title="Always requires a human" />
          <ul className="space-y-1.5 text-[12.5px]">{policies.map((p) => <li key={p} className="flex items-center gap-2"><ShieldCheck size={13} className="shrink-0 text-emerald" />{p}</li>)}</ul>
          <p className="mt-3 text-2xs text-ink-3">Enforced in the workflow validator (consequential actions need an upstream approval node) and, from Phase 3, by the API.</p>
        </Panel>
      </div>
    </div>
  );
}

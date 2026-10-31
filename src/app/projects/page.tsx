'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowRight, CalendarClock, GanttChart, KanbanSquare, List, Sparkles } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { clients, countryByCode, lifecycle, vendors, DEMO_NOW, type LifecycleStage, type Project } from '@/lib/demo/data';
import { deadlineRisk } from '@/lib/assistant';
import { access, can } from '@/lib/roles';
import { useOS } from '@/lib/store';
import { avg, cn, fmtMoney, fmtNum, fmtPct, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Bar, Button, DemoBadge, Drawer, EmptyState, PageHeader, Panel, PanelHeader, ProgressRing, SearchInput, Segmented } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';
import { palette } from '@/lib/tokens';

const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
const dayIdx = (d: string) => Math.round((new Date(d).getTime() - DEMO_NOW.getTime()) / 86400000);
const typeTone = (t: Project['type']) => (t === 'Healthcare' ? 'emerald' : t === 'B2B' ? 'purple' : 'blue');
const health = (p: Project) => {
  const left = dayIdx(p.deadline);
  if (p.blockers.length && left < 14) return { tone: 'danger' as const, label: 'At risk' };
  if (p.blockers.length || left < 5) return { tone: 'warn' as const, label: 'Watch' };
  return { tone: 'emerald' as const, label: 'Healthy' };
};

// Kanban columns group the 16 lifecycle stages into readable lanes
const lanes: { name: string; stages: LifecycleStage[] }[] = [
  { name: 'Pre-sale', stages: ['RFQ Received', 'Feasibility', 'Quotation', 'Client Approval'] },
  { name: 'Setup & programming', stages: ['Project Setup', 'Survey Programming', 'QA'] },
  { name: 'Launch', stages: ['Sample Allocation', 'Soft Launch', 'Full Launch'] },
  { name: 'In field', stages: ['Fieldwork Monitoring'] },
  { name: 'Processing & reporting', stages: ['Data Processing', 'Reporting', 'Client Sign-off'] },
  { name: 'Close-out', stages: ['Invoice', 'Project Closure'] },
];

function Gantt({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  const min = Math.min(...projects.map((p) => dayIdx(p.start)), -30);
  const max = Math.max(...projects.map((p) => dayIdx(p.deadline)), 30);
  const span = max - min;
  const x = (d: number) => ((d - min) / span) * 100;
  const ticks = Array.from({ length: Math.ceil(span / 7) + 1 }, (_, i) => min + i * 7);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className="relative ml-[220px] h-6 border-b hairline text-2xs text-ink-3">
          {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>{new Date(DEMO_NOW.getTime() + t * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>)}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-magenta shadow-[0_0_10px_rgb(var(--magenta))]" style={{ left: `calc(220px + (100% - 220px) * ${x(0) / 100})` }}>
            <span className="absolute -top-1 left-1 rounded bg-magenta px-1 text-[9px] font-bold text-white">Today</span>
          </div>
          {projects.map((p, i) => {
            const s = dayIdx(p.start), e = dayIdx(p.deadline);
            const prog = p.completes / p.target;
            const h = health(p);
            const stageFrac = lifecycle.indexOf(p.stage) / (lifecycle.length - 1);
            return (
              <button key={p.id} onClick={() => onOpen(p.id)} className="group flex h-10 w-full items-center border-b hairline text-left last:border-0 hover:bg-surface-2/30">
                <div className="w-[220px] shrink-0 truncate pr-3 text-[12px]"><span className="font-medium group-hover:text-cyan">{p.name}</span><span className="block text-2xs text-ink-3">{p.owner}</span></div>
                <div className="relative h-full flex-1">
                  {ticks.map((t) => <span key={t} className="absolute bottom-0 top-0 w-px bg-ink-3/10" style={{ left: `${x(t)}%` }} />)}
                  <motion.div
                    className={cn('absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-md ring-1 ring-inset', h.tone === 'danger' ? 'bg-danger/15 ring-danger/40' : h.tone === 'warn' ? 'bg-warn/15 ring-warn/40' : 'bg-blue/15 ring-blue/40')}
                    style={{ left: `${x(s)}%` }}
                    initial={{ width: 0 }} animate={{ width: `${x(e) - x(s)}%` }} transition={{ duration: 0.8, delay: i * 0.03, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    <div className="h-full bg-gradient-to-r from-blue/70 to-cyan/70" style={{ width: `${Math.max(stageFrac, prog) * 100}%` }} />
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] font-semibold text-ink">{p.stage}</span>
                  </motion.div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectDrawer({ p, onClose }: { p: Project | undefined; onClose: () => void }) {
  const role = useOS((s) => s.role);
  const move = useOS((s) => s.moveProject);
  const audit = useOS((s) => s.audit);
  const canEdit = access(role, 'projects') === 'full';
  const margins = can(role, 'view:margins');
  if (!p) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;
  const h = health(p);
  const margin = 1 - p.cpiCost / p.cpiSell;
  return (
    <Drawer open onClose={onClose} title={p.name} subtitle={`${p.code} · ${clientName(p.clientId)} · ${p.type}`} width={560}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={h.tone} dot>{h.label}</Badge><Badge tone={typeTone(p.type)}>{p.type}</Badge>
          {p.countries.map((c) => <Badge key={c}>{countryByCode[c]?.name ?? c}</Badge>)}<DemoBadge />
        </div>
        <div>
          <div className="eyebrow mb-2">Lifecycle</div>
          <div className="flex flex-wrap gap-1">
            {lifecycle.map((st, i) => {
              const cur = lifecycle.indexOf(p.stage);
              return (
                <button key={st} disabled={!canEdit} onClick={() => move(p.id, st)} title={canEdit ? `Move to ${st}` : 'Read only for your role'}
                  className={cn('rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors', i < cur ? 'bg-blue/15 text-blue' : i === cur ? 'bg-gradient-to-r from-blue to-purple text-white' : 'bg-ink-3/10 text-ink-3 hover:text-ink', !canEdit && 'cursor-not-allowed')}>
                  {st}
                </button>
              );
            })}
          </div>
          {!canEdit && <div className="mt-1.5 text-2xs text-ink-3">Read only for your role.</div>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[['Completes', `${fmtNum(p.completes)} / ${fmtNum(p.target)}`], ['Incidence', fmtPct(p.ir)], ['LOI', `${p.loi} min`], ['Dropout', fmtPct(p.dropout)], ['Quality', fmtPct(p.quality)], ['Deadline', `${dayIdx(p.deadline)} days`]].map(([l, v]) => (
            <div key={l} className="panel-solid p-3"><div className="text-2xs text-ink-3">{l}</div><div className="num font-jakarta font-bold">{v}</div></div>
          ))}
        </div>
        <div>
          <div className="eyebrow mb-2">Quota performance</div>
          <div className="flex flex-wrap gap-4">
            {p.quotas.map((q) => (
              <div key={q.id} className="flex flex-col items-center gap-1 text-center">
                <ProgressRing value={q.target ? q.achieved / q.target : 0} size={68} color={q.achieved / q.target < 0.5 ? palette.orange : palette.cyan} sub={`${q.achieved}/${q.target}`} />
                <span className="max-w-[90px] text-2xs text-ink-2">{q.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow mb-2">Budget</div>
          <div className="panel-solid space-y-2 p-3 text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink-3">Budget (cost)</span><span className="num">{fmtMoney(p.budget, false)}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Cost incurred</span><span className="num">{fmtMoney(p.costIncurred, false)}</span></div>
            <Bar value={p.costIncurred / p.budget} tone={p.costIncurred > p.budget * 0.9 ? 'orange' : 'emerald'} />
            {margins ? <div className="flex justify-between"><span className="text-ink-3">Expected margin</span><span className="num font-semibold text-emerald">{fmtPct(margin)}</span></div> : <div className="text-2xs text-ink-3">Margins hidden for your role.</div>}
          </div>
        </div>
        <div>
          <div className="eyebrow mb-2">Suppliers</div>
          {p.vendors.length ? <div className="flex flex-wrap gap-1.5">{p.vendors.map((v) => <Badge key={v} tone="cyan">{vendors.find((x) => x.id === v)?.name}</Badge>)}</div> : <div className="text-[12px] text-ink-3">No sample allocated yet.</div>}
        </div>
        {p.blockers.length > 0 && (
          <div><div className="eyebrow mb-2">Blockers</div>
            <ul className="space-y-1.5">{p.blockers.map((b) => <li key={b} className="flex gap-2 text-[12.5px]"><AlertTriangle size={14} className="mt-0.5 text-orange" />{b}</li>)}</ul>
          </div>
        )}
        <div>
          <div className="eyebrow mb-2">Activity (this session)</div>
          {audit.filter((a) => a.entity === p.id).length ? (
            <ul className="space-y-1 text-[12px]">{audit.filter((a) => a.entity === p.id).slice(0, 6).map((a) => <li key={a.id} className="text-ink-2">{new Date(a.at).toLocaleTimeString()} · {a.action} <span className="text-ink-3">by {a.actor}</span></li>)}</ul>
          ) : <div className="text-[12px] text-ink-3">No changes yet. Moves are written to the audit log.</div>}
        </div>
      </div>
    </Drawer>
  );
}

function ProjectsInner() {
  const s = useOS();
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<'kanban' | 'gantt' | 'list'>('kanban');
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | Project['type']>('all');
  const [dragging, setDragging] = useState<string | null>(null);
  const openId = params.get('open');
  const canEdit = access(s.role, 'projects') === 'full';

  const list = useMemo(() => s.projects.filter((p) => (type === 'all' || p.type === type) && (p.name + p.code + clientName(p.clientId) + p.owner).toLowerCase().includes(q.toLowerCase())), [s.projects, q, type]);
  const field = list.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
  const risks = deadlineRisk(list);
  const setOpen = (id: string | null) => router.replace(id ? `/projects?open=${id}` : '/projects', { scroll: false });

  const quotaLow = list.flatMap((p) => p.quotas.filter((x) => ['Fieldwork Monitoring', 'Full Launch'].includes(p.stage) && x.achieved / x.target < 0.4).map((x) => ({ p, x })));
  const overBudget = list.filter((p) => p.completes > 0 && p.costIncurred / Math.max(1, p.budget * (p.completes / p.target)) > 1.08);

  return (
    <div>
      <PageHeader eyebrow="Research Project Management" title="Projects" subtitle="Every project from RFQ to closure, on one shared record used by CRM, Survey Studio, the Sample Exchange and Finance."
        actions={<><DemoBadge /><Segmented label="proj-view" value={view} onChange={setView} options={[{ value: 'kanban', label: <span className="flex items-center gap-1"><KanbanSquare size={12} />Board</span> }, { value: 'gantt', label: <span className="flex items-center gap-1"><GanttChart size={12} />Timeline</span> }, { value: 'list', label: <span className="flex items-center gap-1"><List size={12} />List</span> }]} /></>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Active projects" value={list.filter((p) => p.stage !== 'Project Closure').length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="In field" value={field.length} format={(n) => fmtNum(n)} status={{ tone: 'ok', text: `${fmtNum(sum(field.map((p) => p.completes)))} completes` }} />
        <KpiCard label="Avg incidence" value={avg(field.map((p) => p.ir))} format={(n) => fmtPct(n)} color="rgb(var(--orange))" />
        <KpiCard label="Avg dropout" value={avg(field.map((p) => p.dropout))} format={(n) => fmtPct(n)} delta={0.012} deltaGoodWhen="down" color="rgb(var(--magenta))" />
        <KpiCard label="Delivery risks" value={risks.length} format={(n) => fmtNum(n)} status={{ tone: risks.length ? 'risk' : 'ok', text: 'From AI PM rule' }} color="rgb(var(--danger))" />
        <KpiCard label="Expected margin" value={avg(list.filter((p) => p.completes).map((p) => 1 - p.cpiCost / p.cpiSell))} format={(n) => fmtPct(n)} redacted={!can(s.role, 'view:margins')} color="rgb(var(--emerald))" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Filter by project, client, owner…" className="w-full sm:w-80" />
        <Segmented label="proj-type" value={type} onChange={setType} options={[{ value: 'all', label: 'All' }, { value: 'B2B', label: 'B2B' }, { value: 'B2C', label: 'B2C' }, { value: 'Healthcare', label: 'Healthcare' }]} />
        <span className="ml-auto text-2xs text-ink-3">{list.length} projects{canEdit ? ' · drag cards between lanes' : ' · read only'}</span>
      </div>

      <div className="grid gap-6 min-[1800px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {!list.length ? <EmptyState title="No projects match" body="Clear the search or type filter." action={<Button size="sm" onClick={() => { setQ(''); setType('all'); }}>Clear filters</Button>} /> : view === 'kanban' ? (
            <div className="flex gap-3 overflow-x-auto pb-3">
              {lanes.map((lane) => {
                const items = list.filter((p) => lane.stages.includes(p.stage));
                return (
                  <div key={lane.name}
                    onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
                    onDrop={() => { if (dragging && canEdit) { s.moveProject(dragging, lane.stages[0]); s.toast(`Moved to ${lane.stages[0]}`); } setDragging(null); }}
                    className={cn('panel-solid flex w-[270px] shrink-0 flex-col p-2.5 transition-colors', dragging && 'ring-1 ring-dashed ring-cyan/30')}>
                    <div className="mb-2 flex items-center justify-between px-1.5"><span className="text-[12px] font-semibold">{lane.name}</span><Badge>{items.length}</Badge></div>
                    <div className="space-y-2">
                      {items.map((p) => {
                        const h = health(p);
                        return (
                          <motion.div layout key={p.id} draggable={canEdit} onDragStart={() => setDragging(p.id)} onDragEnd={() => setDragging(null)} onClick={() => setOpen(p.id)}
                            className="panel cursor-pointer rounded-xl p-3 hover:ring-1 hover:ring-blue/40" role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.id)}>
                            <div className="flex items-start justify-between gap-2"><span className="text-[12.5px] font-semibold leading-snug">{p.name}</span><span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', h.tone === 'danger' ? 'bg-danger' : h.tone === 'warn' ? 'bg-warn' : 'bg-emerald')} title={h.label} /></div>
                            <div className="mt-0.5 text-2xs text-ink-3">{p.code} · {clientName(p.clientId)}</div>
                            <div className="mt-2 flex items-center gap-1.5"><Badge tone={typeTone(p.type)}>{p.type}</Badge><Badge>{p.stage}</Badge></div>
                            {p.completes > 0 && <><div className="num mt-2 flex justify-between text-2xs text-ink-3"><span>{p.completes}/{p.target}</span><span>IR {fmtPct(p.ir, 0)}</span></div><Bar value={p.completes / p.target} className="mt-1" tone="cyan" /></>}
                            <div className="mt-2 flex items-center justify-between text-2xs text-ink-3"><span>{p.owner}</span><span className="flex items-center gap-1"><CalendarClock size={11} />{dayIdx(p.deadline)}d</span></div>
                          </motion.div>
                        );
                      })}
                      {!items.length && <div className="rounded-xl border border-dashed hairline py-6 text-center text-2xs text-ink-3">Drop here</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : view === 'gantt' ? (
            <Panel className="p-4"><Gantt projects={list} onOpen={setOpen} /></Panel>
          ) : (
            <Panel className="overflow-x-auto p-0">
              <table className="w-full min-w-[820px] text-left text-[12.5px]">
                <thead className="text-2xs uppercase tracking-wider text-ink-3"><tr className="border-b hairline">{['Project', 'Client', 'Stage', 'Owner', 'Completes', 'IR', 'Deadline', 'Health'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{list.map((p) => { const h = health(p); return (
                  <tr key={p.id} onClick={() => setOpen(p.id)} className="cursor-pointer border-b hairline last:border-0 hover:bg-surface-2/40">
                    <td className="px-4 py-2.5 font-medium">{p.name}<div className="text-2xs text-ink-3">{p.code}</div></td><td className="px-4 py-2.5 text-ink-2">{clientName(p.clientId)}</td>
                    <td className="px-4 py-2.5"><Badge>{p.stage}</Badge></td><td className="px-4 py-2.5 text-ink-2">{p.owner}</td>
                    <td className="num px-4 py-2.5">{p.completes}/{p.target}</td><td className="num px-4 py-2.5">{fmtPct(p.ir)}</td><td className="num px-4 py-2.5">{dayIdx(p.deadline)}d</td>
                    <td className="px-4 py-2.5"><Badge tone={h.tone} dot>{h.label}</Badge></td>
                  </tr>); })}</tbody>
              </table>
            </Panel>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader eyebrow="Fieldwork" title="Live quota progress" actions={<DemoBadge />} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {field.slice(0, 8).map((p) => (
                  <button key={p.id} onClick={() => setOpen(p.id)} className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center hover:bg-surface-2/40">
                    <ProgressRing value={p.completes / p.target} size={74} stroke={7} color={p.completes / p.target > 0.75 ? palette.emerald : palette.cyan} />
                    <span className="line-clamp-2 text-2xs font-medium text-ink-2">{p.name}</span>
                  </button>
                ))}
              </div>
            </Panel>
            <Panel>
              <PanelHeader eyebrow="Resources" title="Owner workload by stage group" actions={<DemoBadge />} />
              <EChart ariaLabel="Projects per owner by lane" height={250} deps={[list]} option={(t) => {
                const owners = [...new Set(list.map((p) => p.owner))];
                return {
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { right: 0, type: 'scroll' },
                  grid: { left: 8, right: 8, top: 34, bottom: 4, containLabel: true },
                  xAxis: { type: 'value', ...axis(t), minInterval: 1 }, yAxis: { type: 'category', data: owners, ...axis(t), splitLine: { show: false } },
                  series: lanes.map((l) => ({ name: l.name, type: 'bar', stack: 'a', barWidth: 12, itemStyle: { borderRadius: 3 }, data: owners.map((o) => list.filter((p) => p.owner === o && l.stages.includes(p.stage)).length) })),
                };
              }} />
            </Panel>
          </div>
        </div>

        <Panel className="h-fit">
          <PanelHeader eyebrow="AI project manager" title="What needs attention" actions={<Badge tone="purple"><Sparkles size={10} /> Rule-based</Badge>} />
          <div className="space-y-4 text-[12.5px]">
            <section>
              <div className="mb-1.5 font-semibold">Deadline risks ({risks.length})</div>
              {risks.slice(0, 4).map(({ p, left, progress, elapsed }) => (
                <button key={p.id} onClick={() => setOpen(p.id)} className="mb-1.5 block w-full rounded-xl border hairline p-2.5 text-left hover:border-danger/40">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-2xs text-ink-3">{left < 0 ? `${-left} days overdue` : `${left} days left`} · progress {fmtPct(progress, 0)} vs {fmtPct(elapsed, 0)} elapsed{p.blockers[0] ? ` · ${p.blockers[0]}` : ''}</div>
                </button>
              ))}
              {!risks.length && <div className="text-ink-3">None.</div>}
            </section>
            <section>
              <div className="mb-1.5 font-semibold">Low-performing quotas ({quotaLow.length})</div>
              {quotaLow.slice(0, 4).map(({ p, x }) => <div key={p.id + x.id} className="mb-1 flex justify-between gap-2 text-2xs"><span className="truncate text-ink-2">{p.name} · {x.label}</span><span className="num text-orange">{x.achieved}/{x.target}</span></div>)}
              {!quotaLow.length && <div className="text-ink-3">None below 40%.</div>}
            </section>
            <section>
              <div className="mb-1.5 font-semibold">Unexpected cost increases ({overBudget.length})</div>
              {overBudget.slice(0, 4).map((p) => <div key={p.id} className="mb-1 flex justify-between gap-2 text-2xs"><span className="truncate text-ink-2">{p.name}</span><span className="num text-danger">+{fmtPct(p.costIncurred / (p.budget * (p.completes / p.target)) - 1, 0)} vs plan</span></div>)}
              {!overBudget.length && <div className="text-ink-3">Spend tracking to plan.</div>}
            </section>
            <p className="border-t hairline pt-3 text-2xs text-ink-3">Every item above is computed from project records: deadline, completes, quota cells and cost incurred. No model output.</p>
            <Button size="sm" variant="subtle" className="w-full" onClick={() => s.setAssistant(true)}>Draft a status update <ArrowRight size={12} /></Button>
          </div>
        </Panel>
      </div>
      <ProjectDrawer p={s.projects.find((p) => p.id === openId)} onClose={() => setOpen(null)} />
    </div>
  );
}

export default function ProjectsPage() {
  return <Suspense><ProjectsInner /></Suspense>;
}

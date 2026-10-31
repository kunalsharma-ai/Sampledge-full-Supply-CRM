'use client';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { clients, lifecycleToOps, opsStages, type OpsStage } from '@/lib/core';
import { useOS } from '@/lib/store';
import { cn, fmtMoney, fmtPct } from '@/lib/utils';
import { Badge, Bar, Button, EmptyState } from '@/components/ui/primitives';
import { can } from '@/lib/core';

const stageColor = (i: number) => ['#246BFD', '#2F7CFB', '#3B8DF8', '#18D7F2', '#18C9E0', '#13C996', '#3FD08A', '#713BFF', '#8B4DFF', '#B14EFF', '#DA4EFF'][i];

export function OpsFlow() {
  const projects = useOS((s) => s.projects);
  const opportunities = useOS((s) => s.opportunities);
  const role = useOS((s) => s.role);
  const advance = useOS((s) => s.advanceProject);
  const [sel, setSel] = useState<OpsStage>('Fieldwork');

  const byStage = useMemo(() => {
    const m = Object.fromEntries(opsStages.map((s) => [s, [] as typeof projects])) as Record<OpsStage, typeof projects>;
    projects.forEach((p) => m[lifecycleToOps[p.stage]].push(p));
    return m;
  }, [projects]);
  const rfqs = opportunities.filter((o) => o.stage === 'New RFQ' || o.stage === 'Qualifying').length;
  const max = Math.max(...opsStages.map((s) => byStage[s].length), 1);
  const list = byStage[sel];
  const blockers = list.flatMap((p) => p.blockers.map((b) => ({ p, b })));
  const margins = can(role, 'view:margins');

  return (
    <div>
      <div className="relative -mx-1 overflow-x-auto pb-2">
        <div className="relative flex min-w-[1080px] items-stretch gap-0 px-1">
          {opsStages.map((s, i) => {
            const n = byStage[s].length + (s === 'Client Request' ? rfqs : 0);
            const risk = byStage[s].some((p) => p.blockers.length);
            const active = s === sel;
            return (
              <div key={s} className="flex flex-1 items-center">
                <button
                  onClick={() => setSel(s)}
                  aria-pressed={active}
                  className={cn('group relative flex w-full flex-col items-center gap-2 rounded-2xl px-1 py-3 text-center transition-all', active ? 'bg-surface-2/70 ring-1 ring-inset ring-cyan/40' : 'hover:bg-surface-2/40')}
                >
                  <span className="relative grid h-12 w-12 place-items-center">
                    <span className="absolute inset-0 rounded-full opacity-30 blur-md transition-opacity group-hover:opacity-60" style={{ background: stageColor(i) }} />
                    <svg viewBox="0 0 48 48" className="absolute inset-0">
                      <circle cx="24" cy="24" r="21" fill="none" stroke="rgb(var(--line) / var(--line-alpha))" strokeWidth="3" />
                      <motion.circle cx="24" cy="24" r="21" fill="none" stroke={stageColor(i)} strokeWidth="3" strokeLinecap="round" strokeDasharray={132}
                        initial={{ strokeDashoffset: 132 }} animate={{ strokeDashoffset: 132 * (1 - n / (max + rfqs)) }} transition={{ duration: 1, delay: i * 0.06 }} transform="rotate(-90 24 24)" />
                    </svg>
                    <span className="num relative font-jakarta text-[15px] font-bold">{n}</span>
                    {risk && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-orange ring-2 ring-bg" title="Has blockers" />}
                  </span>
                  <span className={cn('text-[11px] font-medium leading-tight', active ? 'text-ink' : 'text-ink-2')}>{s}</span>
                </button>
                {i < opsStages.length - 1 && (
                  <svg width="26" height="12" className="shrink-0" aria-hidden>
                    <line x1="0" y1="6" x2="26" y2="6" stroke={stageColor(i)} strokeOpacity="0.35" strokeWidth="2" />
                    <line x1="0" y1="6" x2="26" y2="6" stroke={stageColor(i + 1)} strokeWidth="2" strokeDasharray="4 8" className="animate-dash-flow" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={sel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="overflow-x-auto rounded-2xl border hairline">
            {list.length ? (
              <table className="w-full min-w-[640px] text-left text-[12.5px]">
                <thead className="text-2xs uppercase tracking-wider text-ink-3">
                  <tr className="border-b hairline">
                    <th className="px-3 py-2.5 font-semibold">Project</th><th className="px-3 py-2.5 font-semibold">Owner</th><th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Progress</th><th className="px-3 py-2.5 font-semibold">{margins ? 'Margin' : 'Budget'}</th><th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const prog = p.completes / p.target;
                    const m = 1 - p.cpiCost / p.cpiSell;
                    return (
                      <tr key={p.id} className="border-b hairline last:border-0 hover:bg-surface-2/40">
                        <td className="px-3 py-2.5"><Link href={`/projects?open=${p.id}`} className="font-medium hover:text-cyan">{p.name}</Link><div className="text-2xs text-ink-3">{p.code} · {clients.find((c) => c.id === p.clientId)?.name}</div></td>
                        <td className="px-3 py-2.5 text-ink-2">{p.owner}</td>
                        <td className="px-3 py-2.5"><Badge tone={p.blockers.length ? 'orange' : 'emerald'} dot>{p.stage}</Badge></td>
                        <td className="w-36 px-3 py-2.5"><div className="num mb-1 text-2xs text-ink-3">{p.completes}/{p.target}</div><Bar value={prog} tone={prog > 0.8 ? 'emerald' : 'cyan'} /></td>
                        <td className="num px-3 py-2.5">{margins ? fmtPct(m) : fmtMoney(p.budget)}</td>
                        <td className="px-3 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => advance(p.id)} title="Advance to next lifecycle stage">Advance <ArrowRight size={12} /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title={`Nothing in ${sel}`} body={sel === 'Client Request' ? `${rfqs} new RFQs are waiting in the Bidding CRM.` : 'Projects appear here as they move through the lifecycle.'} />
            )}
          </div>
          <div className="space-y-3">
            <div className="panel-solid p-4">
              <div className="eyebrow mb-2">{sel} metrics</div>
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div><div className="text-2xs text-ink-3">Projects</div><div className="num font-jakarta text-lg font-bold">{list.length}</div></div>
                <div><div className="text-2xs text-ink-3">Blockers</div><div className="num font-jakarta text-lg font-bold text-orange">{blockers.length}</div></div>
                <div><div className="text-2xs text-ink-3">Completes</div><div className="num font-jakarta text-lg font-bold">{list.reduce((s, p) => s + p.completes, 0).toLocaleString()}</div></div>
                <div><div className="text-2xs text-ink-3">Value</div><div className="num font-jakarta text-lg font-bold">{fmtMoney(list.reduce((s, p) => s + p.cpiSell * p.target, 0))}</div></div>
              </div>
            </div>
            <div className="panel-solid p-4">
              <div className="eyebrow mb-2">Blockers</div>
              {blockers.length ? (
                <ul className="space-y-2">{blockers.slice(0, 5).map(({ p, b }, i) => (
                  <li key={i} className="flex gap-2 text-[12px]"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-orange" /><span><span className="font-medium">{p.name}</span><span className="block text-2xs text-ink-3">{b}</span></span></li>
                ))}</ul>
              ) : <div className="text-[12px] text-ink-3">No blockers at this stage.</div>}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

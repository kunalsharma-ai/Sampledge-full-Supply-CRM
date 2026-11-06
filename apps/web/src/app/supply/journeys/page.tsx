'use client';
/**
 * Screen 29 · Respondent Lifecycle Journeys. A swimlane map: columns are lifecycle stages, lanes are
 * panels. Each cell shows how many members reached the stage this month; the chevrons between
 * cells show conversion to the next stage, coloured against the cross-panel median so weak steps
 * stand out. The bottom lane lists the automations attached to each stage, linking to the builder.
 * Integration: stage counts from `GET /panels/analytics` (available) when connected.
 */
import Link from 'next/link';
import { motion } from 'motion/react';
import { ChevronRight, Workflow } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Panel } from '@/components/ui/primitives';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { journeyCounts, stageAutomations, stageDays, stages, type Stage } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const screen = screenBySlug('journeys')!;
const ids = panelBrands.map((b) => b.id);
const conv = (p: PanelId, i: number) => journeyCounts[p][i + 1] / journeyCounts[p][i];
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export default function Journeys() {
  const [stageIdx, setStageIdx] = useState(3);
  const medians = useMemo(() => stages.slice(0, -1).map((_, i) => median(ids.map((p) => conv(p, i)))), []);
  const stage = stages[stageIdx] as Stage;
  const worst = useMemo(() => {
    let best = { p: ids[0], i: 0, gap: 0 };
    ids.forEach((p) => stages.slice(0, -1).forEach((_, i) => { if (i === 0) return; const gap = medians[i] - conv(p, i); if (gap > best.gap) best = { p, i, gap }; }));
    return best;
  }, [medians]);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Lifecycle journeys" subtitle="From first visit to loyal respondent, per panel. Chevrons show conversion to the next stage; red means below the median across panels." />

      <Panel className="overflow-x-auto p-4">
        <div className="min-w-[980px]">
          <div className="grid gap-1" style={{ gridTemplateColumns: `130px repeat(${stages.length}, minmax(0, 1fr))` }}>
            <span />
            {stages.map((s, i) => (
              <button key={s} onClick={() => setStageIdx(i)} aria-pressed={i === stageIdx} className={cn('rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold', i === stageIdx ? 'bg-primary/10 text-ink ring-1 ring-inset ring-primary/30' : 'text-ink-2 hover:bg-surface-2/50')}>
                {s}<span className="block text-2xs font-normal text-ink-3">median {stageDays[s] < 1 ? `${Math.round(stageDays[s] * 24)}h` : `${stageDays[s]}d`} in</span>
              </button>
            ))}
            {panelBrands.map((b, li) => (
              <div key={b.id} className="contents">
                <div className="flex items-center"><PanelChip panel={b.id} /></div>
                {stages.map((s, i) => {
                  const v = journeyCounts[b.id][i];
                  const c = i < stages.length - 1 ? conv(b.id, i) : null;
                  const below = c !== null && c < medians[i] * 0.95;
                  return (
                    <motion.div key={s} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: li * 0.08 + i * 0.04 }}
                      className={cn('relative flex h-16 items-center rounded-xl pl-3 pr-6', i === stageIdx ? 'ring-1 ring-inset ring-primary/40' : '')}
                      style={{ background: `color-mix(in srgb, ${b.color} ${8 + (v / journeyCounts[b.id][0]) * 30}%, transparent)` }}>
                      <span className="min-w-0"><span className="num block text-[15px] font-bold">{fmtCompact(v)}</span><span className="block truncate text-2xs text-ink-3">{i === 0 ? 'this month' : `${((v / journeyCounts[b.id][0]) * 100).toFixed(1)}% of visits`}</span></span>
                      {c !== null && (
                        <span className={cn('absolute -right-3 z-10 flex flex-col items-center rounded-md bg-surface px-1 py-0.5 text-[10px] font-bold shadow-panel ring-1 ring-inset', below ? 'text-danger ring-danger/40' : 'text-ink-2 ring-ink-3/20')}
                          title={`${Math.round(c * 100)}% continue to ${stages[i + 1]}`}>
                          <ChevronRight size={11} aria-hidden />{Math.round(c * 100)}%
                        </span>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-1 pt-2 text-2xs font-semibold text-ink-3"><Workflow size={12} /> Automations</div>
            {stages.map((s) => (
              <ul key={s} className="space-y-1 pt-2">
                {stageAutomations[s].map((a) => (
                  <li key={a.name}>
                    {a.workflow
                      ? <Link href="/supply/automation" className="block rounded-md border hairline px-2 py-1 text-[11px] hover:border-primary/50"><span className="block truncate font-medium">{a.name}</span>{a.lift !== undefined && <span className="text-2xs text-emerald">+{Math.round(a.lift * 100)} pts lift</span>}</Link>
                      : <span className="block rounded-md border border-dashed hairline px-2 py-1 text-[11px] text-ink-2"><span className="block truncate">{a.name}</span>{a.lift !== undefined && <span className="text-2xs text-emerald">+{Math.round(a.lift * 100)} pts lift</span>}</span>}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Panel className="p-4">
          <SectionTitle eyebrow="Stage detail" title={`${stage}: reached, by panel`} />
          <EChart ariaLabel={`Members reaching ${stage} and the next stage, by panel`} height={220} deps={[stageIdx]} option={(t) => ({
            grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true }, legend: {}, tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: panelBrands.map((b) => b.short), ...axis(t) }, yAxis: { type: 'value', ...axis(t) },
            series: [
              { type: 'bar', name: stage, barWidth: 22, data: panelBrands.map((b) => ({ value: journeyCounts[b.id][stageIdx], itemStyle: { color: b.color, borderRadius: [4, 4, 0, 0] } })) },
              ...(stageIdx < stages.length - 1 ? [{ type: 'bar' as const, name: stages[stageIdx + 1], barWidth: 22, data: panelBrands.map((b) => ({ value: journeyCounts[b.id][stageIdx + 1], itemStyle: { color: `${b.color}73`, borderRadius: [4, 4, 0, 0] } })) }] : []),
            ],
          })} />
        </Panel>
        <Panel className="p-4">
          <SectionTitle eyebrow="Biggest gap" title={`${panelBrands.find((b) => b.id === worst.p)!.short}: ${stages[worst.i]} → ${stages[worst.i + 1]}`} actions={<Badge tone="danger">{Math.round(worst.gap * 100)} pts below median</Badge>} />
          <p className="text-[12.5px] text-ink-2">
            {Math.round(conv(worst.p, worst.i) * 100)}% of {panelBrands.find((b) => b.id === worst.p)!.name} members move from {stages[worst.i]} to {stages[worst.i + 1]}, against {Math.round(medians[worst.i] * 100)}% across panels.
            Closing half the gap would add about <b className="num text-ink">{fmtNum(Math.round(journeyCounts[worst.p][worst.i] * worst.gap * 0.5))}</b> members a month to the next stage.
          </p>
          <p className="mt-2 text-2xs text-ink-3">Attached automations: {stageAutomations[stages[worst.i]].map((a) => a.name).join(', ') || 'none'}.</p>
          <Link href="/supply/automation" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">Open the automation builder <ChevronRight size={13} /></Link>
        </Panel>
      </div>
    </div>
  );
}

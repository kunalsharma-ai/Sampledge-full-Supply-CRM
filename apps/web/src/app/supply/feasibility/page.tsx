'use client';
/**
 * Screen 14 · Audience Feasibility Studio. Up to three scenarios side by side, each walking the
 * audience down from eligible to expected completes with a confidence range, plus a country
 * breakdown for the scenario in focus. Audience comes from the builder (?def=) or a saved segment.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Boxes, Copy, Plus, Send, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { EChart, axis } from '@/components/charts/echart';
import { Button, Panel, buttonVariants, inputCls } from '@/components/ui/primitives';
import { StatusPill } from '@/components/ui/status';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { cond, decodeRoot, describe, feasibility, filterSample, group, type Group, type SavedSegment, type Scenario } from '@/lib/supply/audience';
import { panellists } from '@/lib/supply/panellists';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const NONE: never[] = [];
const screen = screenBySlug('feasibility')!;
const fallback = () => group('AND', [cond('status', ['active']), cond('segment', ['hcp']), cond('specialty', ['Cardiology']), cond('country', ['US', 'GB', 'DE'])]);
const verdict = { yes: { label: 'Feasible', status: 'approved' as const }, tight: { label: 'Tight', status: 'pending' as const }, no: { label: 'Not feasible', status: 'at-risk' as const } };

export default function Page() { return <Suspense><Feasibility /></Suspense>; }

function Feasibility() {
  const params = useSearchParams();
  const toast = useOS((s) => s.toast);
  const saved = useOS((s) => s.prefs['segments'] as SavedSegment[] | undefined) ?? NONE;
  const [root, setRoot] = useState<Group>(fallback);
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { name: 'Plan', completes: 1500, ir: 0.35, loi: 15, days: 14, fatigueDays: 7, incentive: 'standard' },
    { name: 'Smaller sample, boosted incentive', completes: 150, ir: 0.35, loi: 15, days: 7, fatigueDays: 3, incentive: 'boosted' },
  ]);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    const d = params.get('def'); const g = d && decodeRoot(d); if (g) setRoot(g);
    const t = Number(params.get('target')); if (t > 0) setScenarios((ss) => ss.map((s) => ({ ...s, completes: t })));
  }, [params]);

  const sample = useMemo(() => filterSample(panellists(), root), [root]);
  const results = scenarios.map((s) => feasibility(sample, s));
  const f = results[Math.min(focus, results.length - 1)];
  const setS = (i: number, patch: Partial<Scenario>) => setScenarios((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source="demo" title="Feasibility"
        subtitle={<>Audience: <span className="text-ink">{describe(root) || 'everyone'}</span></>}
        actions={<>
          {saved.length > 0 && (
            <select aria-label="Load saved segment" className={cn(inputCls, 'h-8 w-48')} defaultValue="" onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s) setRoot(s.root); }}>
              <option value="" disabled>Load saved segment…</option>{saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <Link href="/supply/segmentation" className={buttonVariants({ size: 'sm', variant: 'ghost' })}><Boxes size={13} /> Edit audience</Link>
          <Button size="sm" variant="primary" disabled={f.feasible === 'no'} onClick={() => toast('Allocation request drafted for SampAudience (demo, nothing sent)', 'info')}><Send size={13} /> Request allocation</Button>
        </>} />

      <div className={cn('grid gap-4', scenarios.length === 3 ? 'xl:grid-cols-3' : 'lg:grid-cols-2')}>
        {scenarios.map((s, i) => {
          const r = results[i];
          const v = verdict[r.feasible];
          const steps = [['Eligible', r.eligible], ['Reachable', r.reachable], ['Invitable now', r.invitable], ['Expected starts', r.starts], ['Expected completes', r.expected]] as const;
          return (
            <Panel key={i} className={cn("p-4 transition-shadow", focus === i && "ring-1 ring-primary/40")} onClick={() => setFocus(i)} onFocusCapture={() => setFocus(i)}>
              <div className="mb-3 flex items-center gap-2">
                <input aria-label="Scenario name" value={s.name} onChange={(e) => setS(i, { name: e.target.value })} className="min-w-0 flex-1 bg-transparent font-display text-[15px] font-semibold outline-none" />
                <StatusPill status={v.status} label={v.label} />
                {scenarios.length > 1 && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={(e) => { e.stopPropagation(); setScenarios(scenarios.filter((_, k) => k !== i)); setFocus(0); }}><X size={13} /></Button>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Completes" value={s.completes} onChange={(n) => setS(i, { completes: n })} min={10} step={50} />
                <Num label="IR %" value={Math.round(s.ir * 100)} onChange={(n) => setS(i, { ir: Math.min(100, Math.max(1, n)) / 100 })} min={1} />
                <Num label="LOI min" value={s.loi} onChange={(n) => setS(i, { loi: n })} min={1} />
                <Num label="Field days" value={s.days} onChange={(n) => setS(i, { days: n })} min={1} />
                <Num label="Fatigue days" value={s.fatigueDays} onChange={(n) => setS(i, { fatigueDays: n })} min={0} />
                <label className="block"><span className="mb-1 block text-2xs text-ink-3">Incentive</span>
                  <select className={cn(inputCls, 'h-8 px-2')} value={s.incentive} onChange={(e) => setS(i, { incentive: e.target.value as Scenario['incentive'] })}><option value="standard">Standard</option><option value="boosted">Boosted +20%</option></select>
                </label>
              </div>
              <ol className="mt-4 space-y-1.5" aria-label="From eligible to expected completes">
                {steps.map(([label, val], k) => (
                  <li key={label}>
                    <div className="flex justify-between text-[12px]"><span className="text-ink-2">{label}</span><span className="num font-semibold">{fmtNum(val)}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-ink-3/12">
                      <motion.div className="h-full rounded-full" style={{ background: `rgb(var(--chart-${k + 1}))` }} initial={false} animate={{ width: `${Math.max(1, (val / Math.max(1, r.eligible)) * 100)}%` }} transition={{ duration: 0.4 }} />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-2/40 p-3 text-center">
                <div><div className="text-2xs text-ink-3">Range</div><div className="num text-[13px] font-semibold">{fmtCompact(r.low)}–{fmtCompact(r.high)}</div></div>
                <div><div className="text-2xs text-ink-3">Coverage</div><div className={cn('num text-[13px] font-semibold', r.expected < s.completes ? 'text-danger' : 'text-emerald')}>{((r.expected / s.completes) * 100).toFixed(0)}%</div></div>
                <div><div className="text-2xs text-ink-3">Est. days</div><div className="num text-[13px] font-semibold">{Number.isFinite(r.daysNeeded) ? r.daysNeeded : '—'}</div></div>
              </div>
              {r.missingProfile > 0 && <p className="mt-2 text-2xs text-ink-3">{fmtNum(r.missingProfile)} eligible panellists have profiles under 60%. <Link href="/supply/profile-automation" className="text-primary hover:underline">Close the gap</Link> to raise reach.</p>}
            </Panel>
          );
        })}
      </div>
      {scenarios.length < 3 && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setScenarios([...scenarios, { ...scenarios[scenarios.length - 1], name: `Scenario ${scenarios.length + 1}` }]); setFocus(scenarios.length); }}><Copy size={13} /> Duplicate last scenario</Button>
          <Button size="sm" variant="ghost" onClick={() => setScenarios([...scenarios, { name: `Scenario ${scenarios.length + 1}`, completes: 500, ir: 0.5, loi: 10, days: 10, fatigueDays: 7, incentive: 'standard' }])}><Plus size={13} /> New scenario</Button>
        </div>
      )}

      <Panel className="p-4">
        <SectionTitle eyebrow={scenarios[focus]?.name} title="By country" actions={<span className="text-2xs text-ink-3">Click a scenario to focus it</span>} />
        <EChart ariaLabel="Eligible panellists and expected completes by country" height={240} deps={[JSON.stringify(scenarios[focus]), describe(root)]} option={(t) => ({
          legend: {}, tooltip: { trigger: 'axis' }, grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
          xAxis: { type: 'category', data: f.byCountry.map((c) => c.code), ...axis(t, { splitLine: { show: false } }) },
          yAxis: [{ type: 'value', name: 'Eligible', ...axis(t) }, { type: 'value', name: 'Completes', ...axis(t, { splitLine: { show: false } }) }],
          series: [
            { type: 'bar', name: 'Eligible', data: f.byCountry.map((c) => c.eligible), barWidth: 16, itemStyle: { borderRadius: [4, 4, 0, 0], color: 'rgb(var(--chart-1))', opacity: 0.55 } },
            { type: 'line', name: 'Expected completes', yAxisIndex: 1, data: f.byCountry.map((c) => c.expected), symbolSize: 7, lineStyle: { width: 2 }, itemStyle: { color: 'rgb(var(--chart-4))' } },
          ],
        })} />
        <p className="mt-2 flex items-center gap-1 text-2xs text-ink-3">Model: reachable = active, consented, no risk flags; invitable = not invited within the fatigue window; starts = response rate × incentive × LOI factor; completes = starts × IR × 86% completion. <ArrowRight size={11} /> In production SampAudience calls SUPPLY360’s eligibility API with this definition.</p>
      </Panel>
    </div>
  );
}

function Num({ label, value, onChange, min, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min: number; step?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs text-ink-3">{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange(Math.max(min, n)); }} className={cn(inputCls, 'num h-8 px-2')} />
    </label>
  );
}

'use client';
/**
 * Screen 35 · Quality & Risk Intelligence. Risk radar (this week against last), the case queue
 * with an evidence timeline for the open case, and rule tuning: move the score threshold and the
 * backtest shows what it would have caught last month, and how many good members it would have
 * flagged. Actions on a member (suspend, clear, watch) are reversible from the same place.
 * Integration: cases `GET /quality/cases` (planned); suspensions use the panellist status API.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, CheckCircle2, Eye, Fingerprint, Gift, LogIn, RotateCcw, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { backtest, riskCases as seed, riskSignals, type RiskCase } from '@/lib/supply/operations';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('quality-risk')!;
const evIcon = { survey: ScrollText, device: Fingerprint, reward: Gift, login: LogIn } as const;
const statusPill = { open: 'pending', suspended: 'flagged', cleared: 'approved', watch: 'paused' } as const;

export default function QualityRisk() {
  const toast = useOS((s) => s.toast);
  const [cases, setCases] = useState(seed);
  const [selId, setSelId] = useState(seed[0].id);
  const [confirm, setConfirm] = useState<RiskCase | null>(null);
  const [thIdx, setThIdx] = useState(5);
  const [applied, setApplied] = useState(5);
  const [confirmRule, setConfirmRule] = useState(false);
  const cur = cases.find((c) => c.id === selId)!;
  const set = (id: string, status: RiskCase['status'], msg: string) => { setCases((l) => l.map((c) => (c.id === id ? { ...c, status } : c))); toast(msg, status === 'suspended' ? 'warn' : 'ok'); };
  const open = cases.filter((c) => c.status === 'open').length;
  const bt = backtest[thIdx], cur0 = backtest[applied];
  const sorted = useMemo(() => [...cases].sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || b.score - a.score), [cases]);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Quality & risk" subtitle="Which fraud and quality signals are rising, the cases they produced, and how strict the rules should be." />

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Panel className="p-4">
          <SectionTitle eyebrow="Share of completes flagged" title="Risk radar" />
          <EChart ariaLabel="Rate of each risk signal this week compared with last week" height={260} option={() => ({
            legend: { bottom: 0, top: 'auto' }, tooltip: {},
            radar: { indicator: riskSignals.map((s) => ({ name: s.label.replace('Open-end gibberish', 'Gibberish').replace('Duplicate device', 'Duplicate'), max: 0.045 })), radius: '62%', axisName: { color: 'rgb(var(--ink-2))', fontSize: 10.5 }, splitLine: { lineStyle: { color: 'rgb(var(--ink-3) / .2)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: 'rgb(var(--ink-3) / .2)' } } },
            series: [{ type: 'radar', data: [
              { name: 'Last week', value: riskSignals.map((s) => s.prev), lineStyle: { type: 'dashed', color: 'rgb(var(--ink-3))' }, itemStyle: { color: 'rgb(var(--ink-3))' }, symbol: 'none' },
              { name: 'This week', value: riskSignals.map((s) => s.rate), areaStyle: { opacity: 0.2 }, itemStyle: { color: 'rgb(var(--danger))' } },
            ] }],
          })} />
          <ul className="mt-2 grid grid-cols-2 gap-1.5 text-[12px]">
            {riskSignals.map((s) => { const up = s.rate > s.prev; return <li key={s.key} className="flex justify-between rounded-md bg-surface-2/40 px-2 py-1"><span className="truncate text-ink-2">{s.label}</span><span className={cn('num font-semibold', up ? 'text-danger' : 'text-emerald')}>{(s.rate * 100).toFixed(1)}%</span></li>; })}
          </ul>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Panel className="p-2">
            <div className="px-2 pb-1 pt-1.5"><SectionTitle eyebrow="Cases" title={`${open} open`} /></div>
            <ul className="space-y-1" aria-label="Risk cases">
              {sorted.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSelId(c.id)} aria-current={c.id === selId ? 'true' : undefined} className={cn('w-full rounded-lg px-2.5 py-2 text-left', c.id === selId ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-2/50', c.status !== 'open' && 'opacity-70')}>
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium"><PanelChip panel={c.panellist.brand} short /><span className="truncate">{c.panellist.handle}</span><span className={cn('num ml-auto text-2xs font-bold', c.score >= 0.75 ? 'text-danger' : 'text-warn')}>{Math.round(c.score * 100)}</span></span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-3"><StatusPill status={statusPill[c.status]} label={c.status} /><span className="truncate">{c.signals.join(', ')}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="p-4">
            <SectionTitle help="Selected case" eyebrow={`${cur.id} · opened ${cur.opened}`} title={cur.panellist.handle} actions={<Link href={`/supply/panellists/${cur.panellist.id}`} className="text-2xs font-semibold text-primary hover:underline">360° profile</Link>} />
            <div className="flex flex-wrap gap-1.5">{cur.signals.map((s) => <Badge key={s} tone="danger">{s}</Badge>)}<Badge tone="neutral">Score {Math.round(cur.score * 100)}</Badge></div>
            <h3 className="eyebrow mb-2 mt-4">Evidence</h3>
            <ol className="relative space-y-3 border-l hairline pl-5" aria-label="Evidence timeline">
              <AnimatePresence initial={false}>
                {cur.evidence.map((e, i) => { const I = evIcon[e.kind]; return (
                  <motion.li key={`${cur.id}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative">
                    <span className="absolute -left-[29px] top-0 grid h-5 w-5 place-items-center rounded-full bg-surface ring-1 ring-ink-3/25"><I size={11} className="text-ink-2" /></span>
                    <div className="text-2xs text-ink-3">{e.at}</div><div className="text-[12.5px]">{e.text}</div>
                  </motion.li>
                ); })}
              </AnimatePresence>
            </ol>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {cur.status === 'open' ? (<>
                <Button size="sm" variant="danger" onClick={() => setConfirm(cur)}><Ban size={13} /> Suspend</Button>
                <Button size="sm" variant="ghost" onClick={() => set(cur.id, 'watch', `${cur.panellist.handle} on watch for 30 days`)}><Eye size={13} /> Watch</Button>
                <Button size="sm" variant="ghost" onClick={() => set(cur.id, 'cleared', `${cur.panellist.handle} cleared`)}><CheckCircle2 size={13} /> Clear</Button>
              </>) : <Button size="sm" variant="ghost" onClick={() => set(cur.id, 'open', `${cur.id} reopened`)}><RotateCcw size={13} /> {cur.status === 'suspended' ? 'Lift suspension and reopen' : 'Reopen case'}</Button>}
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="p-4">
        <SectionTitle eyebrow="Rule tuning · backtest on last month" title={`Flag at score ${Math.round(bt.threshold * 100)} or higher`}
          actions={<Button size="sm" disabled={thIdx === applied} onClick={() => setConfirmRule(true)}>Apply threshold</Button>} />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <EChart ariaLabel="Precision and recall of the risk rule at each score threshold" height={220} deps={[thIdx, applied]} option={(t) => ({
            grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true }, legend: {}, tooltip: { trigger: 'axis', valueFormatter: (v) => `${(Number(v) * 100).toFixed(0)}%` },
            xAxis: { type: 'category', data: backtest.map((b) => Math.round(b.threshold * 100)), name: 'threshold', nameTextStyle: { color: 'rgb(var(--ink-3))' }, ...axis(t) }, yAxis: { type: 'value', max: 1, ...axis(t, { axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%`, color: 'rgb(var(--ink-3))', fontSize: 10 } }) },
            series: [
              { type: 'line', name: 'Fraud caught (recall)', data: backtest.map((b) => b.recall), symbolSize: 5, itemStyle: { color: 'rgb(var(--chart-1))' },
                markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: 'rgb(var(--primary))', type: 'solid' }, data: [{ xAxis: thIdx }] } },
              { type: 'line', name: 'Flags that were fraud (precision)', data: backtest.map((b) => b.precision), symbolSize: 5, itemStyle: { color: 'rgb(var(--chart-4))' },
                markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: 'rgb(var(--ink-3))', type: 'dashed' }, data: [{ xAxis: applied }] } },
            ],
          })} />
          <div className="space-y-2 text-[12.5px]">
            <input aria-label="Score threshold" type="range" min={0} max={backtest.length - 1} value={thIdx} onChange={(e) => setThIdx(Number(e.target.value))} className="w-full accent-[rgb(var(--primary))]" />
            {[['Fraud caught', `${Math.round(bt.recall * 100)}%`, bt.recall - cur0.recall], ['Flags that were fraud', `${Math.round(bt.precision * 100)}%`, bt.precision - cur0.precision], ['Members flagged per month', fmtNum(bt.flagged), (bt.flagged - cur0.flagged) / Math.max(1, cur0.flagged)]].map(([k, v, d]) => (
              <div key={String(k)} className="flex justify-between rounded-lg bg-surface-2/40 px-3 py-2"><span className="text-ink-3">{k}</span><span className="num font-semibold">{v}{thIdx !== applied && <span className="ml-1.5 text-2xs text-ink-3">({Number(d) >= 0 ? '+' : ''}{Math.round(Number(d) * 100)}{k === 'Members flagged per month' ? '%' : ' pts'})</span>}</span></div>
            ))}
            <p className="text-2xs text-ink-3">The solid line is the threshold you are trying; the dashed line is the one in use.</p>
          </div>
        </div>
      </Panel>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={`Suspend ${confirm?.panellist.handle ?? ''}?`}
        body="They stop receiving invitations, and pending redemptions are held. Points are kept. You can lift the suspension from this case at any time."
        confirmLabel="Suspend" onConfirm={() => { if (confirm) set(confirm.id, 'suspended', `${confirm.panellist.handle} suspended`); setConfirm(null); }} />
      <ConfirmDialog open={confirmRule} onOpenChange={setConfirmRule} tone="primary" title={`Flag at score ${Math.round(bt.threshold * 100)} from now on?`}
        body={`Based on last month this would flag about ${fmtNum(bt.flagged)} members a month (now ${fmtNum(cur0.flagged)}) and catch ${Math.round(bt.recall * 100)}% of fraud (now ${Math.round(cur0.recall * 100)}%). Existing cases are not changed.`}
        confirmLabel="Apply" onConfirm={() => { setApplied(thIdx); setConfirmRule(false); toast('Threshold updated', 'ok'); }} />
    </div>
  );
}

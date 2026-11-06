'use client';
/**
 * Screen 35 · Quality & Risk Intelligence. Risk radar (this week against last), the case queue
 * with an evidence timeline for the open case, and rule tuning: move the score threshold and the
 * backtest shows what it would have caught last month, and how many good members it would have
 * flagged. Actions on a member (suspend, clear, watch) are reversible from the same place.
 * Live: cases are `quality_case` records. Suspend, clear and lift a suspension each need a reason;
 * suspending sets the member's status (and lifting it restores the previous one), audited on the
 * member. `GET /supply/quality/summary` gives session outcomes this week against last (the radar)
 * and a backtest at each risk threshold, where "bad" means a member with a quality-failed session or
 * a suspension. "Open cases" (`POST /supply/quality/scan`) opens a case for every member at or above
 * the threshold who has none open. Risk is 1 − the member's quality score.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, CheckCircle2, Eye, Fingerprint, Gift, LogIn, RotateCcw, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useSupplyData } from '@/lib/supply/data';
import { ago, loadPanelistsByIds, loadQualitySummary, records, scanQuality, type QualityCaseData, type QualitySummary, type Rec } from '@/lib/supply/live';
import { fromApiPanelist } from '@/lib/supply/panellists';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Field, Panel, inputCls } from '@/components/ui/primitives';
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
type LCase = RiskCase & { ref?: string; rec?: Rec<QualityCaseData> };
const outcomeKeys = [['terminate', 'Screened out'], ['quota_full', 'Over quota'], ['quality_fail', 'Quality fail'], ['started', 'Not finished']] as const;
type Decide = { c: LCase; action: 'suspend' | 'clear' | 'reinstate' } | null;

export default function QualityRisk() {
  const toast = useOS((s) => s.toast);
  const q = useSupplyData<{ cases: LCase[]; summary: QualitySummary } | null>('quality:cases', () => null, async () => {
    const [recs, summary] = await Promise.all([records.list<QualityCaseData>('quality_case'), loadQualitySummary()]);
    const who = new Map((await loadPanelistsByIds(recs.map((r) => r.data.panelistId))).map((p) => [p.id, p]));
    const cases = recs.flatMap((r): LCase[] => {
      const p = who.get(r.data.panelistId);
      if (!p) return [];
      const evidence: RiskCase['evidence'] = [
        { at: ago(r.createdAt), text: `Opened by the rule “${r.data.rule}” at risk ${Math.round(r.data.score * 100)}.`, kind: 'survey' },
        ...r.data.signals.map((sig) => ({ at: ago(r.createdAt), text: sig, kind: (/session/i.test(sig) ? 'survey' : 'device') as 'survey' | 'device' })),
        { at: 'now', text: `Member is ${p.status}; quality score ${Math.round(p.qualityScore * 100)}; ${p.surveysCompleted} surveys done; ${p.points.toLocaleString()} points.`, kind: 'reward' },
        ...(r.data.decidedReason ? [{ at: ago(r.updatedAt), text: `Decision: ${r.data.decidedReason}`, kind: 'login' as const }] : []),
      ];
      return [{ id: r.id, ref: r.ref, rec: r, panellist: fromApiPanelist(p), score: r.data.score, signals: r.data.signals.length ? r.data.signals : [r.data.rule], opened: ago(r.createdAt), status: r.status === 'watching' ? 'watch' : (r.status as RiskCase['status']), evidence }];
    });
    return { cases, summary };
  });
  const live = q.source === 'live' && q.data ? q.data : null;
  const [demoCases, setCases] = useState(seed);
  const cases: LCase[] = live?.cases ?? demoCases;
  const [selId, setSelId] = useState<string>(seed[0].id);
  const [decide, setDecide] = useState<Decide>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : `Could not ${what}`, 'warn');
  const [confirm, setConfirm] = useState<RiskCase | null>(null);
  const [thIdx, setThIdx] = useState(5);
  const [applied, setApplied] = useState(5);
  const [confirmRule, setConfirmRule] = useState(false);
  const cur = (cases.find((c) => c.id === selId) ?? cases[0]) as LCase | undefined;
  const act = async (c: LCase, action: string, extra: Record<string, unknown>, msg: string) => {
    if (!c.rec) return;
    setBusy(true);
    try { await records.act<QualityCaseData>('quality_case', c.rec, action, extra); q.reload(); toast(msg, action === 'suspend' ? 'warn' : 'ok'); } catch (e) { fail(e, 'decide the case'); } finally { setBusy(false); }
  };
  const set = (id: string, status: RiskCase['status'], msg: string) => {
    const c = cases.find((x) => x.id === id);
    if (live && c) {
      if (status === 'watch') return void act(c, 'watch', {}, msg);
      if (status === 'open') return void act(c, 'reopen', {}, msg);
      return;
    }
    setCases((l) => l.map((c) => (c.id === id ? { ...c, status } : c))); toast(msg, status === 'suspended' ? 'warn' : 'ok'); };
  const open = cases.filter((c) => c.status === 'open').length;
  const bts = live?.summary.backtest ?? backtest;
  const bt = bts[Math.min(thIdx, bts.length - 1)], cur0 = live ? bt : backtest[applied];
  const radar = live ? outcomeKeys.map(([k, label]) => ({ key: k, label, rate: live.summary.outcomes.thisWeek.by[k] ?? 0, prev: live.summary.outcomes.lastWeek.by[k] ?? 0 })) : riskSignals;
  const radarMax = live ? Math.max(0.05, ...radar.flatMap((x) => [x.rate, x.prev])) * 1.15 : 0.045;
  const sorted = useMemo(() => [...cases].sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || b.score - a.score), [cases]);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={live ? 'live' : 'demo'} title="Quality & risk" subtitle="Which fraud and quality signals are rising, the cases they produced, and how strict the rules should be." />

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Panel className="p-4">
          <SectionTitle eyebrow={live ? `Share of SampAudience sessions · ${live.summary.outcomes.thisWeek.total} this week` : 'Share of completes flagged'} title="Risk radar" />
          {live && !live.summary.outcomes.thisWeek.total && !live.summary.outcomes.lastWeek.total
            ? <p className="grid h-[260px] place-items-center px-6 text-center text-[12.5px] text-ink-3">No SampAudience sessions in the last two weeks, so there is nothing to compare yet.</p>
            : <EChart ariaLabel="Rate of each risk signal this week compared with last week" height={260} option={() => ({
            legend: { bottom: 0, top: 'auto' }, tooltip: {},
            radar: { indicator: radar.map((s) => ({ name: s.label.replace('Open-end gibberish', 'Gibberish').replace('Duplicate device', 'Duplicate'), max: radarMax })), radius: '62%', axisName: { color: 'rgb(var(--ink-2))', fontSize: 10.5 }, splitLine: { lineStyle: { color: 'rgb(var(--ink-3) / .2)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: 'rgb(var(--ink-3) / .2)' } } },
            series: [{ type: 'radar', data: [
              { name: 'Last week', value: radar.map((s) => s.prev), lineStyle: { type: 'dashed', color: 'rgb(var(--ink-3))' }, itemStyle: { color: 'rgb(var(--ink-3))' }, symbol: 'none' },
              { name: 'This week', value: radar.map((s) => s.rate), areaStyle: { opacity: 0.2 }, itemStyle: { color: 'rgb(var(--danger))' } },
            ] }],
          })} />}
          <ul className="mt-2 grid grid-cols-2 gap-1.5 text-[12px]">
            {radar.map((s) => { const up = s.rate > s.prev; return <li key={s.key} className="flex justify-between rounded-md bg-surface-2/40 px-2 py-1"><span className="truncate text-ink-2">{s.label}</span><span className={cn('num font-semibold', up ? 'text-danger' : 'text-emerald')}>{(s.rate * 100).toFixed(1)}%</span></li>; })}
          </ul>
          {live && <p className="mt-2 text-2xs text-ink-3">Device, speeding and straight-lining checks run in SampAudience and arrive as quality fails; the signal behind each is not sent to SUPPLY360.</p>}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Panel className="p-2">
            <div className="px-2 pb-1 pt-1.5"><SectionTitle eyebrow="Cases" title={`${open} open`} /></div>
            <ul className="space-y-1" aria-label="Risk cases">
              {sorted.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSelId(c.id)} aria-current={c.id === selId ? 'true' : undefined} className={cn('w-full rounded-lg px-2.5 py-2 text-left', c.id === selId ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-2/50', c.status !== 'open' && 'opacity-70')}>
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium"><PanelChip panel={c.panellist.brand} short /><span className="truncate">{c.panellist.handle}</span>{c.ref && <span className="font-mono text-2xs text-ink-3">{c.ref}</span>}<span className={cn('num ml-auto text-2xs font-bold', c.score >= 0.75 ? 'text-danger' : 'text-warn')}>{Math.round(c.score * 100)}</span></span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-3"><StatusPill status={statusPill[c.status]} label={c.status} /><span className="truncate">{c.signals.join(', ')}</span></span>
                  </button>
                </li>
              ))}
              {cases.length === 0 && <li className="px-2 py-8 text-center text-2xs text-ink-3">No cases yet. Pick a threshold below and open cases for the members above it.</li>}
            </ul>
          </Panel>

          {cur && <Panel className="p-4">
            <SectionTitle help="Selected case" eyebrow={`${cur.ref ?? cur.id} · opened ${cur.opened}`} title={cur.panellist.handle} actions={<Link href={`/supply/panellists/${cur.panellist.id}`} className="text-2xs font-semibold text-primary hover:underline">360° profile</Link>} />
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
              {cur.status === 'open' || (live && cur.status === 'watch') ? (<>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => (live ? setDecide({ c: cur, action: 'suspend' }) : setConfirm(cur))}><Ban size={13} /> Suspend</Button>
                {cur.status === 'open' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => set(cur.id, 'watch', `${cur.panellist.handle} on watch`)}><Eye size={13} /> Watch</Button>}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => (live ? setDecide({ c: cur, action: 'clear' }) : set(cur.id, 'cleared', `${cur.panellist.handle} cleared`))}><CheckCircle2 size={13} /> Clear</Button>
              </>) : live && cur.status === 'suspended'
                ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDecide({ c: cur, action: 'reinstate' })}><RotateCcw size={13} /> Lift suspension</Button>
                : <Button size="sm" variant="ghost" disabled={busy} onClick={() => set(cur.id, 'open', `${cur.ref ?? cur.id} reopened`)}><RotateCcw size={13} /> {cur.status === 'suspended' ? 'Lift suspension and reopen' : 'Reopen case'}</Button>}
            </div>
          </Panel>}
        </div>
      </div>

      <Panel className="p-4">
        <SectionTitle eyebrow={live ? `Rule tuning · backtest on ${live.summary.members.toLocaleString()} members, ${live.summary.bad} known bad` : 'Rule tuning · backtest on last month'} title={`Flag at score ${Math.round(bt.threshold * 100)} or higher`}
          actions={<Button size="sm" disabled={live ? busy || bt.flagged === 0 : thIdx === applied} onClick={() => setConfirmRule(true)}>{live ? 'Open cases' : 'Apply threshold'}</Button>} />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <EChart ariaLabel="Precision and recall of the risk rule at each score threshold" height={220} deps={[thIdx, applied]} option={(t) => ({
            grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true }, legend: {}, tooltip: { trigger: 'axis', valueFormatter: (v) => `${(Number(v) * 100).toFixed(0)}%` },
            xAxis: { type: 'category', data: bts.map((b) => Math.round(b.threshold * 100)), name: 'threshold', nameTextStyle: { color: 'rgb(var(--ink-3))' }, ...axis(t) }, yAxis: { type: 'value', max: 1, ...axis(t, { axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%`, color: 'rgb(var(--ink-3))', fontSize: 10 } }) },
            series: [
              { type: 'line', name: 'Fraud caught (recall)', data: bts.map((b) => b.recall), symbolSize: 5, itemStyle: { color: 'rgb(var(--chart-1))' },
                markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: 'rgb(var(--primary))', type: 'solid' }, data: [{ xAxis: thIdx }] } },
              { type: 'line', name: 'Flags that were fraud (precision)', data: bts.map((b) => b.precision), symbolSize: 5, itemStyle: { color: 'rgb(var(--chart-4))' },
                markLine: { symbol: 'none', label: { show: false }, lineStyle: { color: 'rgb(var(--ink-3))', type: 'dashed' }, data: [{ xAxis: applied }] } },
            ],
          })} />
          <div className="space-y-2 text-[12.5px]">
            <input aria-label="Score threshold" type="range" min={0} max={bts.length - 1} value={thIdx} onChange={(e) => setThIdx(Number(e.target.value))} className="w-full accent-[rgb(var(--primary))]" />
            {[['Fraud caught', `${Math.round(bt.recall * 100)}%`, bt.recall - cur0.recall], ['Flags that were fraud', `${Math.round(bt.precision * 100)}%`, bt.precision - cur0.precision], [live ? 'Members at or above it' : 'Members flagged per month', fmtNum(bt.flagged), (bt.flagged - cur0.flagged) / Math.max(1, cur0.flagged)]].map(([k, v, d]) => (
              <div key={String(k)} className="flex justify-between rounded-lg bg-surface-2/40 px-3 py-2"><span className="text-ink-3">{k}</span><span className="num font-semibold">{v}{!live && thIdx !== applied && <span className="ml-1.5 text-2xs text-ink-3">({Number(d) >= 0 ? '+' : ''}{Math.round(Number(d) * 100)}{k === 'Members flagged per month' ? '%' : ' pts'})</span>}</span></div>
            ))}
            <p className="text-2xs text-ink-3">{live ? '“Open cases” opens a case for each active or dormant member at or above the threshold who has no open case.' : 'The solid line is the threshold you are trying; the dashed line is the one in use.'}</p>
          </div>
        </div>
      </Panel>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={`Suspend ${confirm?.panellist.handle ?? ''}?`}
        body="They stop receiving invitations, and pending redemptions are held. Points are kept. You can lift the suspension from this case at any time."
        confirmLabel="Suspend" onConfirm={() => { if (confirm) set(confirm.id, 'suspended', `${confirm.panellist.handle} suspended`); setConfirm(null); }} />
      {live ? <ConfirmDialog open={confirmRule} onOpenChange={setConfirmRule} tone="primary" title={`Open cases at risk ${Math.round(bt.threshold * 100)} or higher?`}
        body={`Up to ${fmtNum(bt.flagged)} members are at or above it (at most 200 per run); members who already have an open or watched case are skipped. Nobody is suspended until someone decides a case.`}
        confirmLabel="Open cases" onConfirm={() => { setConfirmRule(false); setBusy(true); scanQuality(bt.threshold).then((r) => { q.reload(); toast(r.opened ? `Opened ${r.opened} case${r.opened === 1 ? '' : 's'}` : 'No new members to open cases for', 'ok'); }).catch((e) => fail(e, 'open cases')).finally(() => setBusy(false)); }} />
      : <ConfirmDialog open={confirmRule} onOpenChange={setConfirmRule} tone="primary" title={`Flag at score ${Math.round(bt.threshold * 100)} from now on?`}
        body={`Based on last month this would flag about ${fmtNum(bt.flagged)} members a month (now ${fmtNum(cur0.flagged)}) and catch ${Math.round(bt.recall * 100)}% of fraud (now ${Math.round(cur0.recall * 100)}%). Existing cases are not changed.`}
        confirmLabel="Apply" onConfirm={() => { setApplied(thIdx); setConfirmRule(false); toast('Threshold updated', 'ok'); }} />}
      <ConfirmDialog open={!!decide} onOpenChange={(o) => { if (!o) { setDecide(null); setReason(''); } }} tone={decide?.action === 'suspend' ? 'danger' : 'primary'}
        title={decide ? (decide.action === 'suspend' ? `Suspend ${decide.c.panellist.handle}?` : decide.action === 'clear' ? `Clear ${decide.c.panellist.handle}?` : `Lift ${decide.c.panellist.handle}’s suspension?`) : ''}
        body={<div className="space-y-2">
          <p>{decide?.action === 'suspend' ? 'They stop receiving invitations and pending redemptions are held. Points are kept. You can lift the suspension from this case.' : decide?.action === 'clear' ? 'The case closes with no change to the member.' : 'The member goes back to the status they had before.'}</p>
          <Field label="Reason (kept in the audit log)"><textarea rows={2} className={cn(inputCls, 'h-auto py-1.5')} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>}
        confirmLabel={decide?.action === 'suspend' ? 'Suspend' : decide?.action === 'clear' ? 'Clear' : 'Lift suspension'}
        onConfirm={() => {
          if (!decide) return;
          if (reason.trim().length < 3) { toast('Give a reason of at least 3 characters', 'warn'); return; }
          const { c, action } = decide;
          void act(c, action, { reason: reason.trim() }, action === 'suspend' ? `${c.panellist.handle} suspended` : action === 'clear' ? `${c.panellist.handle} cleared` : `${c.panellist.handle} reinstated`);
          setReason('');
        }} />
    </div>
  );
}

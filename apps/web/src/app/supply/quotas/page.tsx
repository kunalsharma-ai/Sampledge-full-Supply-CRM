'use client';
/**
 * Screen 25 · Quota Monitoring. A matrix of every quota cell coloured by pace (achieved share of
 * target over share of field time passed), a burn-down for the selected cell with a projection,
 * and the actions an operator takes on a cell: close it, boost its incentive, or add a batch.
 * A watch-list on the right gathers at-risk cells across every live survey.
 * Live: projects in soft launch, full launch or fieldwork from `GET /projects`, with their QuotaCell
 * rows (target, count, hard, closed). Closing a cell is `POST /supply/quotas/:id/close` with a
 * reason (routing then treats it as full); reopening is `/reopen`. Per-day history is not recorded,
 * so live cells show today's count against the ideal line. Incentive boosts and extra batches are
 * SampAudience actions and are made there.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { CalendarPlus, Lock, TrendingUp, Zap } from 'lucide-react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Switch } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { SectionTitle, SupplyHeader, SurveySourceChip } from '@/components/supply/kit';
import { ApiError } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { closeQuota, loadProjects, reopenQuota, type LiveProject } from '@/lib/supply/live';
import { pace, paceBand, paceMeta, surveys, type QuotaCell, type Survey } from '@/lib/supply/fieldwork';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('quotas')!;
const demoTracked = surveys.filter((s) => s.status === 'live' || s.status === 'soft-launch' || s.status === 'paused');
const FIELD = ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'];
const day = 86400_000;
type Tracked = Survey & { closedIds?: string[] };
/** A fieldwork project as a tracked survey: field days from start to deadline, cells from QuotaCell rows. */
function fromProject(p: LiveProject): Tracked {
  const start = new Date(p.start).getTime(), end = new Date(p.deadline).getTime();
  const fieldDays = Math.max(1, Math.round((end - start) / day));
  return {
    id: p.id, ref: p.code, title: p.name, client: '', source: 'Partner', partner: 'Projects', status: p.stage === 'Soft Launch' ? 'soft-launch' : 'live',
    panels: [], countries: p.countries, cpi: p.cpiSell ?? 0, ir: p.ir, loi: p.loi, target: p.target, completes: p.completes,
    elapsed: Math.min(1, Math.max(0, (Date.now() - start) / Math.max(day, end - start))), fieldDays, priority: 2, audience: p.audience, dropoff: 0, quality: 0,
    quotas: p.quotas.map((q) => ({ id: q.id, dim: 'Quota cells', label: q.label, target: q.target, achieved: q.count, hard: q.hard, history: [] })),
    closedIds: p.quotas.filter((q) => q.closedAt).map((q) => q.id),
  };
}

/** Completes still needed per remaining field day, and the day the cell fills at the current rate. */
function projection(c: QuotaCell, s: Survey) {
  const daysSoFar = c.history.length || Math.max(1, Math.round(s.elapsed * s.fieldDays));
  const rate = c.achieved / Math.max(1, daysSoFar);
  const left = Math.max(0, s.fieldDays - daysSoFar);
  const projected = Math.round(c.achieved + rate * left);
  const needPerDay = left ? Math.ceil((c.target - c.achieved) / left) : c.target - c.achieved;
  return { rate, left, projected, needPerDay, fillsOnDay: rate > 0 ? Math.ceil(c.target / rate) : Infinity };
}

export default function QuotasPage() { return <Suspense><Quotas /></Suspense>; }

function Quotas() {
  const params = useSearchParams();
  const toast = useOS((s) => s.toast);
  const live = useOS((s) => s.mode === 'live' && !!s.session);
  const q = useSupplyData<Tracked[] | null>('quotas:projects', () => null, async () => (await loadProjects()).filter((p) => FIELD.includes(p.stage) && p.quotas.length).map(fromProject));
  const tracked: Tracked[] = live && q.data ? q.data : demoTracked;
  const [sid, setSid] = useState<string | null>(params.get('s'));
  const s = tracked.find((x) => x.id === sid) ?? tracked.find((x) => x.status === 'live') ?? tracked[0];
  const [localClosed, setClosed] = useState<Set<string>>(new Set());
  const closed = useMemo(() => (live && q.data ? new Set(q.data.flatMap((x) => x.closedIds ?? [])) : localClosed), [live, q.data, localClosed]);
  const [reason, setReason] = useState('');
  const [boosted, setBoosted] = useState<Set<string>>(new Set());
  const [cellId, setCellId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<QuotaCell | null>(null);
  const [rules, setRules] = useState({ autoClose: true, autoBoost: false, autoBatch: true });

  const worstCell = (sv: Survey) => [...sv.quotas].sort((a, b) => pace(a.achieved, a.target, sv.elapsed) - pace(b.achieved, b.target, sv.elapsed))[0];
  useEffect(() => { if (s && !s.quotas.some((c) => c.id === cellId)) setCellId(worstCell(s).id); }, [sid, s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dims = useMemo(() => [...new Set((s?.quotas ?? []).map((c) => c.dim))], [s]);
  const watch = useMemo(() => tracked.flatMap((sv) => sv.quotas.filter((c) => !closed.has(c.id) && paceBand(c.achieved, c.target, sv.elapsed) === 'risk').map((c) => ({ sv, c, pace: pace(c.achieved, c.target, sv.elapsed) })))
    .sort((a, b) => a.pace - b.pace).slice(0, 8), [closed, tracked]);

  if (!s) return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={q.source} title="Quota monitoring" subtitle="Each cell is coloured by pace: how much of its target is in, against how much field time has passed." />
      <Panel className="p-10 text-center text-[13px] text-ink-2">No project in soft launch, full launch or fieldwork has quota cells yet. Cells appear here once a survey with quotas is published and fielding.</Panel>
    </div>
  );
  const cell = s.quotas.find((c) => c.id === cellId) ?? worstCell(s);
  const p = projection(cell, s);
  const band = closed.has(cell.id) ? 'full' : paceBand(cell.achieved, cell.target, s.elapsed);
  const daysSoFar = cell.history.length || Math.max(1, Math.round(s.elapsed * s.fieldDays));
  const xs = Array.from({ length: s.fieldDays }, (_, i) => `D${i + 1}`);
  const ideal = xs.map((_, i) => Math.round((cell.target * (i + 1)) / s.fieldDays));
  const actual = cell.history.length ? cell.history : xs.map((_, i) => (i === daysSoFar - 1 ? cell.achieved : null));
  const proj = xs.map((_, i) => (i < daysSoFar - 1 ? null : Math.min(cell.target * 1.2, Math.round(cell.achieved + p.rate * (i + 1 - daysSoFar)))));

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={q.source} title="Quota monitoring" subtitle="Each cell is coloured by pace: how much of its target is in, against how much field time has passed."
        actions={
          <label className="flex items-center gap-2 text-2xs text-ink-3">Survey
            <select className={cn(inputCls, 'h-8 w-72')} value={s.id} onChange={(e) => setSid(e.target.value)}>
              {tracked.map((x) => <option key={x.id} value={x.id}>{x.title} · {x.status}</option>)}
            </select>
          </label>} />

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Panel className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SurveySourceChip source={s.source} partner={s.partner} /><span className="font-mono text-2xs text-ink-3">{s.ref}</span>
              <StatusPill status={s.status === 'soft-launch' ? 'soft-launch' : s.status === 'paused' ? 'paused' : 'live'} />
              <span className="text-2xs text-ink-3">Day {Math.max(1, Math.round(s.fieldDays * s.elapsed))} of {s.fieldDays} · {fmtNum(s.completes)} / {fmtNum(s.target)} completes</span>
              <ul className="ml-auto flex flex-wrap gap-2.5 text-2xs text-ink-3" aria-label="Legend">
                {(['ahead', 'on', 'behind', 'risk', 'full'] as const).map((b) => <li key={b} className="flex items-center gap-1"><span className={cn('h-2.5 w-2.5 rounded-[3px]', paceMeta[b].cls)} />{paceMeta[b].label}</li>)}
              </ul>
            </div>
            <div className="space-y-3">
              {dims.map((d) => (
                <div key={d}>
                  <h3 className="eyebrow mb-1.5">{d}</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {s.quotas.filter((c) => c.dim === d).map((c, i) => {
                      const isClosed = closed.has(c.id);
                      const b = isClosed ? 'full' : paceBand(c.achieved, c.target, s.elapsed);
                      const pc = pace(c.achieved, c.target, s.elapsed);
                      return (
                        <motion.button key={c.id} onClick={() => setCellId(c.id)} aria-pressed={c.id === cell.id}
                          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
                          className={cn('relative overflow-hidden rounded-xl p-3 text-left ring-1 ring-inset transition-shadow', c.id === cell.id ? 'ring-2 ring-primary' : 'ring-ink-3/15 hover:ring-ink-3/35')}>
                          <span className={cn('absolute inset-0 -z-0', paceMeta[b].cls)} style={{ opacity: 0.55 }} aria-hidden />
                          <span className="relative block">
                            <span className="flex items-center gap-1 text-[12.5px] font-semibold">{c.label}{isClosed && <Lock size={11} aria-label="Closed" />}{boosted.has(c.id) && <Zap size={11} className="text-orange" aria-label="Incentive boosted" />}</span>
                            <span className="num mt-0.5 block text-[18px] font-bold leading-tight">{c.achieved}<span className="text-[12px] font-medium text-ink-3"> / {c.target}</span></span>
                            <span className="mt-0.5 flex items-center justify-between text-2xs"><span className={cn('font-semibold', paceMeta[b].text)}>{paceMeta[b].label}</span><span className="num text-ink-3">{c.hard ? 'hard' : 'soft'} · {Math.round(pc * 100)}% pace</span></span>
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-4">
            <SectionTitle eyebrow={`${cell.dim} · ${cell.label}`} title="Burn-up and projection"
              actions={<span className={cn('text-2xs font-semibold', paceMeta[band].text)}>{paceMeta[band].label}</span>} />
            <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
              <EChart ariaLabel={`Cumulative completes for ${cell.label} against the ideal line`} height={230} deps={[cell.id, closed.has(cell.id)]} option={(t) => ({
                grid: { left: 8, right: 12, top: 30, bottom: 8, containLabel: true },
                legend: { data: ['Actual', 'Ideal', 'Projected'] },
                tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: xs, ...axis(t) },
                yAxis: { type: 'value', ...axis(t) },
                series: [
                  { type: 'line', name: 'Ideal', data: ideal, symbol: 'none', lineStyle: { type: 'dashed', width: 1.5, color: 'rgb(var(--ink-3))' }, itemStyle: { color: 'rgb(var(--ink-3))' } },
                  { type: 'line', name: 'Actual', data: actual, symbolSize: 6, lineStyle: { width: 2.5 }, itemStyle: { color: 'rgb(var(--chart-1))' }, areaStyle: { opacity: 0.12 },
                    markLine: { symbol: 'none', silent: true, label: { formatter: 'Target', color: 'rgb(var(--ink-2))' }, lineStyle: { color: 'rgb(var(--emerald))', type: 'solid' }, data: [{ yAxis: cell.target }] } },
                  { type: 'line', name: 'Projected', data: proj, symbol: 'none', lineStyle: { type: 'dotted', width: 2 }, itemStyle: { color: 'rgb(var(--chart-4))' } },
                ],
              })} />
              <div className="space-y-2 text-[12.5px]">
                {[['Rate so far', `${p.rate.toFixed(1)} / day`], ['Needed per day', p.left ? `${p.needPerDay} / day` : '—'], ['Projected at close', `${fmtNum(p.projected)} of ${cell.target}`], ['Fills on', Number.isFinite(p.fillsOnDay) ? (p.fillsOnDay <= s.fieldDays ? `day ${p.fillsOnDay}` : `day ${p.fillsOnDay} (late)`) : 'never at this rate']].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 rounded-lg bg-surface-2/40 px-3 py-2"><span className="text-ink-3">{k}</span><span className="num font-semibold">{v}</span></div>
                ))}
                <div className="flex flex-col gap-1.5 pt-1">
                  <Button size="sm" variant="ghost" disabled={boosted.has(cell.id) || closed.has(cell.id)} onClick={() => { if (live) { toast('Incentive boosts are set on the audience request in SampAudience', 'info'); return; } setBoosted((b) => new Set(b).add(cell.id)); toast(`Incentive +20% for ${cell.label}`, 'ok'); }}><TrendingUp size={13} /> Boost incentive +20%</Button>
                  <Button size="sm" variant="ghost" disabled={closed.has(cell.id)} onClick={() => toast(live ? 'Extra batches are scheduled on the audience request in SampAudience' : `Batch of ${Math.max(50, p.needPerDay * 6)} invites added for ${cell.label}`, live ? 'info' : 'ok')}><CalendarPlus size={13} /> Add a targeted batch</Button>
                  {closed.has(cell.id) && live
                    ? <Button size="sm" onClick={async () => { try { await reopenQuota(cell.id); q.reload(); toast(`${cell.label} reopened`, 'ok'); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reopen the cell', 'warn'); } }}><Lock size={13} /> Reopen cell</Button>
                    : <Button size="sm" variant="danger" disabled={closed.has(cell.id)} onClick={() => setConfirmClose(cell)}><Lock size={13} /> Close cell</Button>}
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="Across all live surveys" title="Watch-list" actions={<Badge tone={watch.length ? 'danger' : 'emerald'}>{watch.length} at risk</Badge>} />
            <ul className="space-y-1.5">
              {watch.map(({ sv, c, pace: pc }) => (
                <li key={c.id}>
                  <button onClick={() => { setSid(sv.id); setCellId(c.id); }} className="w-full rounded-lg bg-surface-2/30 px-3 py-2 text-left hover:bg-surface-2/60">
                    <span className="flex items-center justify-between gap-2 text-[12.5px]"><span className="truncate font-medium">{c.label}</span><span className="num text-2xs font-semibold text-danger">{Math.round(pc * 100)}%</span></span>
                    <span className="block truncate text-2xs text-ink-3">{sv.title} · {c.achieved}/{c.target}</span>
                  </button>
                </li>
              ))}
              {watch.length === 0 && <li className="py-6 text-center text-2xs text-ink-3">No cells at risk.</li>}
            </ul>
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="Automatic actions" title="Rules" />
            <ul className="space-y-3 text-[12.5px]">
              {([['autoClose', 'Close hard cells when full', 'Stops over-quota entries the moment a cell fills.'], ['autoBoost', 'Boost incentive below 70% pace', 'Raises the incentive 20% for that cell, capped by the rate card.'], ['autoBatch', 'Add a batch below 80% pace', 'Sends a targeted batch inside each country’s send window.']] as const).map(([k, label, hint]) => (
                <li key={k} className="flex items-start gap-3">{live
                  ? <Badge tone={k === 'autoClose' ? 'emerald' : 'neutral'} className="mt-0.5 shrink-0">{k === 'autoClose' ? 'Always on' : 'SampAudience'}</Badge>
                  : <Switch checked={rules[k]} onCheckedChange={(v) => { setRules((r) => ({ ...r, [k]: v })); toast(`${label}: ${v ? 'on' : 'off'}`, 'info'); }} label={label} />}
                  <span><span className="block font-medium">{label}</span><span className="text-2xs text-ink-3">{hint}</span></span></li>
              ))}
            </ul>
            {live && <p className="mt-3 text-2xs text-ink-3">Hard cells always stop counting when full. Incentive boosts and extra batches are rules on each audience request in SampAudience.</p>}
          </Panel>
        </div>
      </div>

      <ConfirmDialog open={!!confirmClose} onOpenChange={(o) => !o && setConfirmClose(null)} title={`Close the ${confirmClose?.label ?? ''} cell?`}
        body={confirmClose ? <>
          <p>New respondents who match {confirmClose.label} will be sent the over-quota end. {Math.max(0, confirmClose.target - confirmClose.achieved)} completes are still open in this cell. You can reopen it later.</p>
          {live && <label className="mt-3 block text-2xs text-ink-3">Why is it closing? (kept in the audit log)
            <textarea rows={2} className={cn(inputCls, 'mt-1 h-auto py-2')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Client asked to stop this cell" /></label>}
        </> : ''}
        confirmLabel="Close cell" onConfirm={async () => {
          const c = confirmClose; setConfirmClose(null);
          if (!c) return;
          if (live) {
            if (reason.trim().length < 3) { toast('Say why the cell is closing', 'warn'); return; }
            try { await closeQuota(c.id, reason.trim()); setReason(''); q.reload(); toast(`${c.label} closed`, 'warn'); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not close the cell', 'warn'); }
            return;
          }
          setClosed((x) => new Set(x).add(c.id)); toast(`${c.label} closed`, 'warn');
        }} />
    </div>
  );
}

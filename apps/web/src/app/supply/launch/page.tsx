'use client';
/**
 * Screen 23 · Soft Launch & Full Launch. Left: the launch checklist (automatic checks tick
 * themselves; manual ones need a person). Centre: the soft-launch read-out, plan against what the
 * first completes show, with drop-off per question. Right: the full-launch gate, which stays shut
 * until the checklist is done and any off-plan metric has a written reason.
 * Integration: launch goes to SAMPLEON `POST /sampleon/v1/surveys/:id/launch` (planned).
 */
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Circle, Lock, Rocket, Unlock } from 'lucide-react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { CountryChips, SectionTitle, SupplyHeader, SurveySourceChip } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { launchChecklist, softLaunchReadout, surveys, type SurveyStatus } from '@/lib/supply/fieldwork';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('launch')!;
const candidates = surveys.filter((s) => s.status === 'soft-launch' || s.status === 'scheduled' || s.status === 'draft');

export default function LaunchPage() { return <Suspense><Launch /></Suspense>; }

function Launch() {
  const params = useSearchParams();
  const toast = useOS((s) => s.toast);
  const first = candidates.find((s) => s.id === params.get('s')) ?? candidates.find((s) => s.status === 'soft-launch') ?? candidates[0];
  const [sid, setSid] = useState(first.id);
  const [stage, setStage] = useState<Record<string, SurveyStatus>>({});
  const s = candidates.find((x) => x.id === sid)!;
  const status = stage[s.id] ?? s.status;
  const [checks, setChecks] = useState<Record<string, Set<string>>>({});
  const done = checks[s.id] ?? new Set(launchChecklist.filter((c) => c.auto).map((c) => c.id));
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<'soft' | 'full' | null>(null);
  const ro = useMemo(() => softLaunchReadout(s), [s]);
  const offPlan = ro.metrics.filter((m) => !m.ok);
  const checklistDone = launchChecklist.every((c) => done.has(c.id));
  const hasData = status === 'soft-launch' || status === 'live';
  const gateOpen = status === 'soft-launch' && checklistDone && (offPlan.length === 0 || reason.trim().length >= 12);
  const toggle = (id: string) => setChecks((c) => { const n = new Set(done); n.has(id) ? n.delete(id) : n.add(id); return { ...c, [s.id]: n }; });
  const fmtM = (v: number, unit: '%' | 'min') => (unit === '%' ? `${(v * 100).toFixed(0)}%` : `${v.toFixed(1)} min`);

  const steps: { id: SurveyStatus; label: string }[] = [{ id: 'draft', label: 'Draft' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'soft-launch', label: `Soft launch (${ro.sample})` }, { id: 'live', label: 'Full launch' }];
  const stepIdx = steps.findIndex((x) => x.id === status);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Soft launch & full launch" subtitle="Field a small sample first, check it against the plan, then open the survey to everyone."
        actions={
          <label className="flex items-center gap-2 text-2xs text-ink-3">Survey
            <select className={cn(inputCls, 'h-8 w-72')} value={sid} onChange={(e) => { setSid(e.target.value); setReason(''); }}>
              {candidates.map((x) => <option key={x.id} value={x.id}>{x.title} · {stage[x.id] ?? x.status}</option>)}
            </select>
          </label>} />

      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SurveySourceChip source={s.source} partner={s.partner} /><span className="font-semibold">{s.title}</span><span className="text-2xs text-ink-3">{s.client} · {s.ref}</span><CountryChips codes={s.countries} />
        </div>
        <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Launch stages">
          {steps.map((st, i) => (
            <li key={st.id} aria-current={i === stepIdx ? 'step' : undefined} className="relative">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-3/12"><motion.div className="h-full bg-primary" initial={false} animate={{ width: i <= stepIdx ? '100%' : '0%' }} transition={{ duration: 0.4 }} /></div>
              <div className={cn('mt-1.5 text-2xs', i === stepIdx ? 'font-semibold text-ink' : i < stepIdx ? 'text-ink-2' : 'text-ink-3')}>{st.label}</div>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr_300px]">
        <Panel className="p-4">
          <SectionTitle eyebrow="Before full launch" title="Checklist" actions={<span className="num text-2xs text-ink-3">{done.size}/{launchChecklist.length}</span>} />
          <ul className="space-y-1">
            {launchChecklist.map((c) => {
              const on = done.has(c.id);
              return (
                <li key={c.id}>
                  <button onClick={() => !c.auto && toggle(c.id)} disabled={c.auto} aria-pressed={on}
                    className={cn('flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-[12.5px]', !c.auto && 'hover:bg-surface-2/50')}>
                    {on ? <CheckCircle2 size={16} className="mt-px shrink-0 text-emerald" /> : <Circle size={16} className="mt-px shrink-0 text-ink-3" />}
                    <span className="flex-1"><span className={cn(on ? 'text-ink' : 'text-ink-2')}>{c.label}</span>{c.auto && <span className="block text-2xs text-ink-3">Checked automatically</span>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Soft-launch read-out" title={hasData ? `${ro.done} of ${ro.sample} soft-launch completes` : 'No soft-launch data yet'}
            actions={hasData && <Badge tone={offPlan.length ? 'warn' : 'emerald'}>{offPlan.length ? `${offPlan.length} off plan` : 'All on plan'}</Badge>} />
          {hasData ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {ro.metrics.map((m) => (
                  <div key={m.label} className={cn('rounded-xl p-3 ring-1 ring-inset', m.ok ? 'bg-surface-2/30 ring-ink-3/10' : 'bg-warn/10 ring-warn/30')}>
                    <div className="flex items-center justify-between text-2xs text-ink-3">{m.label}{!m.ok && <AlertTriangle size={12} className="text-warn" aria-label="Off plan" />}</div>
                    <div className="mt-1 flex items-baseline gap-2"><span className="num font-jakarta text-xl font-bold">{fmtM(m.actual, m.unit)}</span><span className="text-2xs text-ink-3">plan {fmtM(m.plan, m.unit)}</span></div>
                    <div className={cn('num text-2xs font-semibold', m.ok ? 'text-emerald' : 'text-warn')}>{m.diff >= 0 ? '+' : ''}{(m.diff * 100).toFixed(0)}% vs plan</div>
                  </div>
                ))}
              </div>
              <h3 className="eyebrow mb-1 mt-4">Drop-off by question</h3>
              <EChart ariaLabel="Share of respondents who left at each question" height={180} deps={[s.id]} option={(t) => ({
                grid: { left: 8, right: 8, top: 14, bottom: 4, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (v) => `${v}%` },
                xAxis: { type: 'category', data: ro.dropoffByQuestion.map((d) => d.q), ...axis(t) }, yAxis: { type: 'value', ...axis(t, { axisLabel: { formatter: '{value}%', color: 'rgb(var(--ink-3))', fontSize: 10.5 } }) },
                series: [{ type: 'bar', name: 'Drop-off', barWidth: 14, data: ro.dropoffByQuestion.map((d) => ({ value: d.drop, itemStyle: { color: d.drop > 3 ? 'rgb(var(--danger))' : 'rgb(var(--chart-2))', borderRadius: [3, 3, 0, 0] } })) }],
              })} />
              <p className="mt-2 text-2xs text-ink-3">{ro.openEndsFlagged} open-ended answers flagged for review. {ro.dropoffByQuestion.some((d) => d.drop > 3) && <>Most people leave at <b className="text-ink">{ro.dropoffByQuestion.reduce((a, b) => (b.drop > a.drop ? b : a)).q}</b>; check its length and wording with the client.</>}</p>
            </>
          ) : (
            <div className="grid place-items-center gap-3 py-12 text-center">
              <p className="max-w-sm text-[13px] text-ink-2">A soft launch sends the survey to about 10% of the target ({ro.sample} completes) so incidence, length and drop-off can be checked before the full send.</p>
              <Button size="sm" onClick={() => setConfirm('soft')}><Rocket size={13} /> Start soft launch</Button>
            </div>
          )}
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Full launch" title={gateOpen ? 'Ready to launch' : status === 'live' ? 'Launched' : 'Gate closed'} />
          <div className={cn('mb-3 grid h-24 place-items-center rounded-2xl', gateOpen ? 'bg-emerald/10 text-emerald' : status === 'live' ? 'bg-primary/10 text-primary' : 'bg-ink-3/10 text-ink-3')}>
            {gateOpen || status === 'live' ? <Unlock size={30} /> : <Lock size={30} />}
          </div>
          <ul className="mb-3 space-y-1 text-[12.5px]">
            <li className="flex items-center gap-2">{status === 'soft-launch' || status === 'live' ? <CheckCircle2 size={14} className="text-emerald" /> : <Circle size={14} className="text-ink-3" />} Soft launch has data</li>
            <li className="flex items-center gap-2">{checklistDone ? <CheckCircle2 size={14} className="text-emerald" /> : <Circle size={14} className="text-ink-3" />} Checklist complete</li>
            <li className="flex items-center gap-2">{hasData && offPlan.length === 0 ? <CheckCircle2 size={14} className="text-emerald" /> : <Circle size={14} className="text-ink-3" />} Metrics on plan, or a reason given</li>
          </ul>
          {hasData && offPlan.length > 0 && status !== 'live' && (
            <label className="mb-3 block text-2xs text-ink-3">Why launch with {offPlan.map((m) => m.label.toLowerCase()).join(' and ')} off plan?
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={cn(inputCls, 'mt-1 h-auto py-2')} placeholder="For example: client accepted the lower incidence and raised the CPI." aria-invalid={reason.length > 0 && reason.trim().length < 12 || undefined} />
            </label>
          )}
          {status === 'live'
            ? <StatusPill status="live" label={`Live · ${fmtNum(s.target)} target`} />
            : <Button className="w-full" disabled={!gateOpen} onClick={() => setConfirm('full')}><Rocket size={14} /> Full launch</Button>}
        </Panel>
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} tone="primary"
        title={confirm === 'full' ? `Full launch ${s.title}?` : `Start the soft launch of ${s.title}?`}
        body={confirm === 'full'
          ? `Invitations go out in the scheduled batches until ${fmtNum(s.target)} completes are in. You can pause from the inventory at any time.${reason ? ` Your reason is saved with the launch: “${reason.trim()}”.` : ''}`
          : `${ro.sample} completes will be collected across ${s.countries.join(', ')} before anything else is sent.`}
        confirmLabel={confirm === 'full' ? 'Launch' : 'Start soft launch'}
        onConfirm={() => { setStage((st) => ({ ...st, [s.id]: confirm === 'full' ? 'live' : 'soft-launch' })); toast(confirm === 'full' ? `${s.title} is live` : `Soft launch started for ${s.title}`, 'ok'); setConfirm(null); }} />
    </div>
  );
}

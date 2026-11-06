'use client';
/**
 * Screen 24 · Batch Scheduling. A week-long timeline (UTC) with one row per invitation batch.
 * Each row shades that country's quiet hours (21:00 to 08:00 local), so a batch dragged into the
 * night is visibly wrong and is refused. Bars move by drag or, with focus, by ←/→ (1 hour) and
 * Shift+←/→ (1 day). The side panel previews the send curve for the chosen throttle.
 * Integration: batches map to SAMPLEON `PATCH /sampleon/v1/batches/:id` (planned).
 */
import { Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { Moon, Send, Undo2 } from 'lucide-react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { Kbd } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { batches as seed, inQuietHours, localHour, NOW_HOUR, surveyById, surveys, type Batch } from '@/lib/supply/fieldwork';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('batches')!;
const HOURS = 7 * 24;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const statusCls: Record<Batch['status'], string> = {
  sent: 'bg-ink-3/40 text-ink', sending: 'bg-cyan/80 text-bg', scheduled: 'bg-primary-strong text-on-primary', held: 'bg-warn/70 text-bg',
};
const fmtHour = (h: number) => `${DAYS[Math.floor(h / 24) % 7]} ${String(Math.floor(h % 24)).padStart(2, '0')}:00`;

/** Quiet-hour stripes for a row, as [start, end) UTC hour ranges. */
function quietRanges(country: string) {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let h = 0; h <= HOURS; h++) {
    const l = localHour(h, country);
    const q = h < HOURS && (l >= 21 || l < 8);
    if (q && start === null) start = h;
    if (!q && start !== null) { out.push([start, h]); start = null; }
  }
  return out;
}

export default function BatchesPage() { return <Suspense><Batches /></Suspense>; }

function Batches() {
  const params = useSearchParams();
  const toast = useOS((s) => s.toast);
  const [list, setList] = useState(seed);
  const [history, setHistory] = useState<Batch[][]>([]);
  const filterInit = params.get('s') && seed.some((b) => b.surveyId === params.get('s')) ? params.get('s')! : 'all';
  const [filter, setFilter] = useState(filterInit);
  const [selId, setSelId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const track = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => list.filter((b) => filter === 'all' || b.surveyId === filter).sort((a, b) => a.surveyId.localeCompare(b.surveyId) || a.country.localeCompare(b.country) || a.start - b.start), [list, filter]);
  /** One timeline row per survey and country; that row's batches sit side by side on it. */
  const lanes = useMemo(() => {
    const m = new Map<string, Batch[]>();
    for (const b of rows) { const k = `${b.surveyId}|${b.country}`; m.set(k, [...(m.get(k) ?? []), b]); }
    return [...m.entries()].map(([key, bs]) => ({ key, surveyId: bs[0].surveyId, country: bs[0].country, utcOffset: bs[0].utcOffset, bs }));
  }, [rows]);
  const sel = list.find((b) => b.id === selId) ?? rows.find((b) => b.status === 'scheduled') ?? rows[0];
  const [throttle, setThrottle] = useState<Record<string, number>>({});
  const thr = sel ? throttle[sel.id] ?? sel.throttle : 0;
  const surveyOptions = surveys.filter((s) => seed.some((b) => b.surveyId === s.id));

  const commit = (b: Batch, start: number) => {
    const s = Math.max(Math.ceil(NOW_HOUR), Math.min(HOURS - b.duration, Math.round(start)));
    if (s === b.start) return;
    if (inQuietHours(s, b.duration, b.country)) { toast(`Not moved: ${fmtHour(s)} UTC is inside ${b.country} quiet hours`, 'warn'); return; }
    setHistory((h) => [...h.slice(-19), list]);
    setList((l) => l.map((x) => (x.id === b.id ? { ...x, start: s } : x)));
    toast(`Batch moved to ${fmtHour(s)} UTC (${String(Math.floor(localHour(s, b.country))).padStart(2, '0')}:00 in ${b.country})`, 'ok');
  };
  const pxPerHour = () => (track.current ? track.current.clientWidth / HOURS : 6);
  const onPointerDown = (e: React.PointerEvent, b: Batch) => {
    if (b.status !== 'scheduled') return;
    setSelId(b.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => setDrag({ id: b.id, dx: (ev.clientX - x0) / pxPerHour() });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDrag(null);
      const dh = (ev.clientX - x0) / pxPerHour();
      if (Math.abs(dh) >= 0.5) commit(b, b.start + dh);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onKey = (e: React.KeyboardEvent, b: Batch) => {
    if (b.status !== 'scheduled') return;
    const step = e.shiftKey ? 24 : 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); commit(b, b.start + step); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); commit(b, b.start - step); }
  };

  const curve = sel ? Array.from({ length: Math.max(1, Math.ceil(sel.invites / Math.max(10, thr))) }, (_, i) => Math.min(thr, sel.invites - i * thr)) : [];
  const conflict = sel ? inQuietHours(sel.start, curve.length, sel.country) : false;
  const totals = { scheduled: rows.filter((b) => b.status === 'scheduled').reduce((a, b) => a + b.invites, 0), sent: rows.filter((b) => b.status === 'sent').reduce((a, b) => a + b.invites, 0) };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Batch scheduling" subtitle="Plan invitation waves per country. Times are UTC; shaded bands are each country’s quiet hours, when nothing is sent."
        actions={<>
          <Button size="sm" variant="ghost" disabled={!history.length} onClick={() => { setList(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); toast('Move undone', 'info'); }}><Undo2 size={13} /> Undo</Button>
          <label className="flex items-center gap-2 text-2xs text-ink-3">Survey
            <select className={cn(inputCls, 'h-8 w-64')} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All surveys</option>
              {surveyOptions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        </>} />

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Panel className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b hairline px-4 py-2.5 text-2xs text-ink-3">
            <span><b className="num text-ink">{fmtNum(totals.sent)}</b> sent</span><span><b className="num text-ink">{fmtNum(totals.scheduled)}</b> scheduled</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">Focus a bar, then <Kbd>←</Kbd><Kbd>→</Kbd> 1h · <Kbd>Shift</Kbd> 1 day</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <div className="grid grid-cols-[180px_1fr] border-b hairline text-2xs text-ink-3">
                <div className="px-3 py-1.5">Batch</div>
                <div className="relative grid grid-cols-7">{DAYS.map((d) => <div key={d} className="border-l hairline px-1.5 py-1.5">{d}</div>)}</div>
              </div>
              <ul aria-label="Invitation batches">
                {lanes.map((lane) => {
                  const sv = surveyById(lane.surveyId)!;
                  const active = lane.bs.some((b) => b.id === sel?.id);
                  return (
                    <li key={lane.key} className={cn('grid grid-cols-[180px_1fr] border-b hairline', active && 'bg-primary/[.05]')}>
                      <button onClick={() => setSelId(lane.bs[0].id)} className="min-w-0 px-3 py-1.5 text-left">
                        <span className="block truncate text-[12px] font-medium">{sv.title}</span>
                        <span className="text-2xs text-ink-3">{lane.country} · UTC{lane.utcOffset >= 0 ? '+' : ''}{lane.utcOffset} · {fmtNum(lane.bs.reduce((a, b) => a + b.invites, 0))}</span>
                      </button>
                      <div ref={track} className="relative h-11">
                        {quietRanges(lane.country).map(([a, z]) => <span key={a} className="absolute inset-y-0 bg-ink-3/[.07]" style={{ left: `${(a / HOURS) * 100}%`, width: `${((z - a) / HOURS) * 100}%` }} aria-hidden />)}
                        {DAYS.map((_, i) => i > 0 && <span key={i} className="absolute inset-y-0 border-l hairline" style={{ left: `${(i / 7) * 100}%` }} aria-hidden />)}
                        <span className="absolute inset-y-0 border-l-2 border-danger/60" style={{ left: `${(NOW_HOUR / HOURS) * 100}%` }} aria-hidden />
                        {lane.bs.map((b) => {
                          const dx = drag?.id === b.id ? drag.dx : 0;
                          const start = b.start + dx;
                          const bad = drag?.id === b.id && inQuietHours(Math.round(start), b.duration, b.country);
                          return (
                            <motion.button key={b.id}
                              layout={drag?.id !== b.id}
                              onPointerDown={(e) => onPointerDown(e, b)} onKeyDown={(e) => onKey(e, b)} onClick={() => setSelId(b.id)}
                              title={`${fmtHour(b.start)} UTC · ${fmtNum(b.invites)} invites · ${b.status}`}
                              aria-label={`${sv.title}, ${b.country}, ${fmtHour(b.start)} UTC for ${b.duration} hours, ${fmtNum(b.invites)} invites, ${b.status}${b.status === 'scheduled' ? '. Arrow keys move it.' : ''}`}
                              className={cn('absolute top-2.5 h-6 rounded-md shadow-panel', statusCls[b.status], b.status === 'scheduled' ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-default', bad && 'ring-2 ring-danger', sel?.id === b.id && 'ring-2 ring-focus ring-offset-1 ring-offset-bg')}
                              style={{ left: `${(start / HOURS) * 100}%`, width: `${Math.max(1.6, (b.duration / HOURS) * 100)}%` }} />
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 px-4 py-2.5 text-2xs text-ink-3">
            {(['sent', 'sending', 'scheduled', 'held'] as const).map((s) => <span key={s} className="flex items-center gap-1"><span className={cn('h-2.5 w-4 rounded-sm', statusCls[s])} />{s}</span>)}
            <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-ink-3/[.15]" /><Moon size={11} /> quiet hours (local)</span>
            <span className="ml-auto">Now: {fmtHour(NOW_HOUR)} UTC</span>
          </div>
        </Panel>

        {sel && (
          <Panel className="p-4">
            <SectionTitle eyebrow={`${sel.country} · ${sel.status}`} title={surveyById(sel.surveyId)!.title} />
            <dl className="mb-3 grid grid-cols-2 gap-2 text-center text-[12.5px]">
              {[['Starts (UTC)', fmtHour(sel.start)], ['Local start', `${String(Math.floor(localHour(sel.start, sel.country))).padStart(2, '0')}:00`], ['Invites', fmtNum(sel.invites)], ['Window', `${curve.length} h`]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">{k}</dt><dd className="num font-semibold">{v}</dd></div>
              ))}
            </dl>
            <label className="block text-2xs text-ink-3">Throttle: <b className="num text-ink">{thr}</b> invites per hour
              <input type="range" min={20} max={Math.max(40, Math.ceil(sel.invites / 10) * 10)} step={10} value={thr} disabled={sel.status !== 'scheduled'}
                onChange={(e) => setThrottle((t) => ({ ...t, [sel.id]: Number(e.target.value) }))} className="mt-1 w-full accent-[rgb(var(--primary))]" />
            </label>
            <EChart ariaLabel="Invitations sent per hour at this throttle" height={140} deps={[sel.id, thr]} option={(t) => ({
              grid: { left: 6, right: 6, top: 10, bottom: 4, containLabel: true }, tooltip: { trigger: 'axis' },
              xAxis: { type: 'category', data: curve.map((_, i) => `+${i}h`), ...axis(t) }, yAxis: { type: 'value', ...axis(t) },
              series: [{ type: 'bar', name: 'Invites', data: curve, barWidth: '60%', itemStyle: { color: 'rgb(var(--chart-1))', borderRadius: [3, 3, 0, 0] } }],
            })} />
            {conflict
              ? <Badge tone="warn" className="mt-2">At this throttle the send runs into quiet hours. Raise the throttle or move the batch earlier.</Badge>
              : <p className="mt-2 text-2xs text-ink-3">Finishes by {String(Math.floor(localHour(sel.start + curve.length, sel.country))).padStart(2, '0')}:00 local time.</p>}
            {sel.status === 'scheduled' && (
              <Button size="sm" className="mt-3 w-full" disabled={conflict} onClick={() => { setList((l) => l.map((x) => (x.id === sel.id ? { ...x, throttle: thr, duration: curve.length } : x))); toast('Batch saved', 'ok'); }}><Send size={13} /> Save batch</Button>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

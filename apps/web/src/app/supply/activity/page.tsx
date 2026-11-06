'use client';
/**
 * Screen 36 · Panellist Activity Timeline. Every event across every panellist in the last 24 hours:
 * a lane per event type (dots on a time axis), a scrubber to pick the window, filters, and the
 * event list for that window with jump-to-profile. "Follow live" appends new events as they arrive.
 * Integration: stream from `GET /panels/events?since=` (planned; SSE when available).
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Pause, Play, Radio } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Panel, SearchInput, Segmented } from '@/components/ui/primitives';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { activity as seed, eventTypes, type ActivityEvent, type EventKey } from '@/lib/supply/operations';
import { fromApiPanelist, panellists } from '@/lib/supply/panellists';
import { useSupplyData } from '@/lib/supply/data';
import { loadEvents, loadPanelistsByIds } from '@/lib/supply/live';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, rng } from '@/lib/utils';

const screen = screenBySlug('activity')!;
const DAY = 1440;
/** The last 24 hours from GET /panels/events, placed on the same minute scale as the demo set. */
async function loadActivity(): Promise<ActivityEvent[] | null> {
  const r = await loadEvents(24);
  if (!r) return null;
  const ids = [...new Set(r.events.map((e) => e.panelistId))].slice(0, 1000);
  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  const people = new Map((await Promise.all(chunks.map(loadPanelistsByIds))).flat().map((p) => [p.id, fromApiPanelist(p)]));
  const now = Date.now();
  return r.events.flatMap((e) => {
    const p = people.get(e.panelistId);
    return p ? [{ id: e.id, type: e.type, minute: Math.max(0, DAY - (now - new Date(e.at).getTime()) / 60_000), panellist: p, text: e.text }] : [];
  });
}

const liveText: Record<EventKey, string> = { signup: 'Joined from the app', profile: 'Updated profile', survey: 'Completed a survey (+200 pts)', reward: 'Redeemed $10 gift card', support: 'Opened a ticket', risk: 'Speeder flag raised' };

export default function Activity() {
  const reduced = useOS((s) => s.motion === 'reduced');
  const data = useSupplyData('activity', () => seed, loadActivity);
  const isLive = data.source === 'live';
  const [events, setEvents] = useState<ActivityEvent[]>(seed);
  useEffect(() => { setEvents(data.data); }, [data.data]);
  const [types, setTypes] = useState<Set<EventKey>>(new Set(eventTypes.map((t) => t.key)));
  const [panel, setPanel] = useState<'all' | PanelId>('all');
  const [q, setQ] = useState('');
  const [win, setWin] = useState<[number, number]>([DAY - 180, DAY]);
  const [live, setLive] = useState(false);
  const n = useRef(0);

  useEffect(() => {
    if (!live || !isLive) return;
    const t = setInterval(data.reload, 30_000);
    return () => clearInterval(t);
  }, [live, isLive, data.reload]);

  useEffect(() => {
    if (!live || isLive) return;
    const r = rng(99 + n.current);
    const t = setInterval(() => {
      n.current++;
      const type = eventTypes[Math.floor(r() * eventTypes.length * 0.999)].key;
      const p = panellists()[Math.floor(r() * 4000)];
      setEvents((e) => [...e, { id: `live-${n.current}`, type, minute: DAY - 0.01, panellist: p, text: liveText[type] }].map((x) => (x.id.startsWith('live') ? x : { ...x, minute: x.minute - 0.03 })));
    }, reduced ? 4000 : 1800);
    return () => clearInterval(t);
  }, [live, reduced, isLive]);

  const filtered = useMemo(() => events.filter((e) => types.has(e.type) && (panel === 'all' || e.panellist.brand === panel) && (!q || `${e.panellist.handle} ${e.text}`.toLowerCase().includes(q.toLowerCase()))), [events, types, panel, q]);
  const inWin = useMemo(() => filtered.filter((e) => e.minute >= win[0] && e.minute <= win[1]).sort((a, b) => b.minute - a.minute), [filtered, win]);
  const toggle = (k: EventKey) => setTypes((s) => { const n2 = new Set(s); n2.has(k) ? n2.delete(k) : n2.add(k); return n2.size ? n2 : s; });
  const nowLabel = 'now';

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={data.source} title="Activity timeline" subtitle="Every panellist event in the last 24 hours, by type. Drag the window to read a stretch of time; follow live to watch events arrive."
        actions={<Button size="sm" variant={live ? 'primary' : 'ghost'} onClick={() => setLive((v) => !v)}>{live ? <><Pause size={13} /> Following live</> : <><Play size={13} /> Follow live</>}</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Handle or event…" className="w-full sm:w-60" />
        <Segmented label="Panel" size="sm" value={panel} onChange={setPanel} options={[{ value: 'all', label: 'All panels' }, ...panelBrands.map((b) => ({ value: b.id, label: b.short }))]} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Event types">
          {eventTypes.map((t) => (
            <button key={t.key} onClick={() => toggle(t.key)} aria-pressed={types.has(t.key)} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium', types.has(t.key) ? 'hairline bg-surface text-ink' : 'border-dashed border-ink-3/30 text-ink-3')}>
              <span className="h-2 w-2 rounded-full" style={{ background: types.has(t.key) ? t.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${t.color}` }} aria-hidden />{t.label}
            </button>
          ))}
        </div>
      </div>

      <Panel className="p-4">
        <div className="relative" role="img" aria-label={`Events by type over 24 hours. ${filtered.length} events shown; window from ${Math.round((DAY - win[0]) / 60)} hours ago to ${win[1] >= DAY ? 'now' : `${Math.round((DAY - win[1]) / 60)} hours ago`}.`}>
          <div className="grid grid-cols-[110px_1fr] gap-y-1.5">
            {eventTypes.filter((t) => types.has(t.key)).map((t) => (
              <div key={t.key} className="contents">
                <span className="flex items-center text-2xs text-ink-2">{t.label}</span>
                <div className="relative h-6 rounded-md bg-surface-2/30">
                  <span className="absolute inset-y-0 rounded-md bg-primary/[.08]" style={{ left: `${(win[0] / DAY) * 100}%`, width: `${((win[1] - win[0]) / DAY) * 100}%` }} aria-hidden />
                  {filtered.filter((e) => e.type === t.key).map((e) => (
                    <span key={e.id} className={cn('absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full')} style={{ left: `${(e.minute / DAY) * 100}%`, background: t.color, opacity: e.minute >= win[0] && e.minute <= win[1] ? 0.95 : 0.3 }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="ml-[110px] mt-1 flex justify-between text-[10px] text-ink-3">{[0, 4, 8, 12, 16, 20].map((h) => <span key={h}>−{24 - h}h</span>)}<span>{nowLabel}</span></div>
        </div>
        <div className="ml-[110px] mt-3 grid grid-cols-2 gap-3">
          <label className="text-2xs text-ink-3">Window from <b className="num text-ink">−{Math.round((DAY - win[0]) / 6) / 10}h</b>
            <input type="range" min={0} max={DAY - 15} step={15} value={win[0]} onChange={(e) => { const v = Number(e.target.value); setWin(([, b]) => [Math.min(v, b - 15), b]); }} className="w-full accent-[rgb(var(--primary))]" /></label>
          <label className="text-2xs text-ink-3">to <b className="num text-ink">{win[1] >= DAY ? 'now' : `−${Math.round((DAY - win[1]) / 6) / 10}h`}</b>
            <input type="range" min={15} max={DAY} step={15} value={win[1]} onChange={(e) => { const v = Number(e.target.value); setWin(([a]) => [a, Math.max(v, a + 15)]); }} className="w-full accent-[rgb(var(--primary))]" /></label>
        </div>
      </Panel>

      <Panel className="p-0">
        <div className="flex items-center gap-2 border-b hairline px-4 py-3">
          <SectionTitle eyebrow="In the window" title={`${inWin.length} events`} />
          {live && <Badge tone="cyan" className="ml-auto"><Radio size={11} /> live</Badge>}
        </div>
        <ol className="max-h-[480px] overflow-y-auto" aria-label="Events, newest first" aria-live={live ? 'polite' : undefined}>
          <AnimatePresence initial={false}>
            {inWin.slice(0, 150).map((e) => {
              const t = eventTypes.find((x) => x.key === e.type)!;
              return (
                <motion.li key={e.id} layout={!reduced} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                  className="flex items-center gap-3 border-b hairline px-4 py-2 text-[12.5px]">
                  <span className="num w-16 shrink-0 text-2xs text-ink-3">{e.id.startsWith('live') || DAY - e.minute < 1 ? 'now' : DAY - e.minute < 60 ? `${Math.round(DAY - e.minute)}m ago` : `${Math.floor((DAY - e.minute) / 60)}h ${Math.round((DAY - e.minute) % 60)}m ago`}</span>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden /><span className="sr-only">{t.label}:</span>
                  <span className="min-w-0 flex-1 truncate">{e.text}</span>
                  <Link href={`/supply/panellists/${e.panellist.id}`} className="flex shrink-0 items-center gap-1.5 text-2xs text-ink-2 hover:text-primary hover:underline"><PanelChip panel={e.panellist.brand} short /><span className="max-w-[160px] truncate">{e.panellist.handle}</span></Link>
                </motion.li>
              );
            })}
          </AnimatePresence>
          {inWin.length === 0 && <li className="py-12 text-center text-[13px] text-ink-3">No events in this window. Widen it or turn more event types on.</li>}
        </ol>
        {inWin.length > 150 && <p className="px-4 py-2 text-2xs text-ink-3">Showing the newest 150. Narrow the window to see older ones.</p>}
      </Panel>
    </div>
  );
}

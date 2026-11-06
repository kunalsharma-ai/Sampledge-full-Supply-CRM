'use client';
/**
 * Screen 16 · Survey Inventory. Every survey panellists can be routed to, whatever its source.
 * Board view groups by status (the default, because operators think in launch stages); table view
 * is for sorting by CPI, IR or pace. Each card shows quota health as a strip of cell dots.
 * Integration: SAMPLEON `GET /sampleon/v1/surveys` (planned) merges PROJEXA and ZAPX inventory.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, LayoutGrid, MoreHorizontal, Pause, Play, Rocket, Route, Rows3, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Bar, Button, Drawer, Panel, SearchInput, Segmented, buttonVariants } from '@/components/ui/primitives';
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/overlay';
import { DataTable, type Column } from '@/components/ui/table';
import { StatusDot, StatusPill, type Status } from '@/components/ui/status';
import { CountryChips, PanelChip, SectionTitle, SupplyHeader, SurveySourceChip } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { paceBand, paceMeta, surveys as seed, type Survey, type SurveyStatus } from '@/lib/supply/fieldwork';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtMoney, fmtNum } from '@/lib/utils';

const screen = screenBySlug('surveys')!;
const columns: { id: SurveyStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'soft-launch', label: 'Soft launch' },
  { id: 'live', label: 'Live' }, { id: 'paused', label: 'Paused' }, { id: 'closed', label: 'Closed' },
];
const pill: Record<SurveyStatus, Status> = { draft: 'draft', scheduled: 'scheduled', 'soft-launch': 'soft-launch', live: 'live', paused: 'paused', closed: 'closed' };
/** Moves an operator may make from the board. Launching goes through the launch screen's checks. */
const moves: Record<SurveyStatus, SurveyStatus[]> = { draft: ['scheduled'], scheduled: ['draft'], 'soft-launch': ['paused'], live: ['paused', 'closed'], paused: ['live', 'closed'], closed: [] };

function QuotaStrip({ s }: { s: Survey }) {
  const bands = s.quotas.map((q) => paceBand(q.achieved, q.target, s.elapsed));
  const risk = bands.filter((b) => b === 'risk').length;
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex flex-wrap gap-0.5" aria-hidden>{bands.map((b, i) => <span key={i} className={cn('h-2 w-2 rounded-[3px]', paceMeta[b].cls)} />)}</span>
      <span className={cn('text-2xs', risk ? 'font-semibold text-danger' : 'text-ink-3')}>{risk ? `${risk} cell${risk > 1 ? 's' : ''} at risk` : `${s.quotas.length} cells`}</span>
    </div>
  );
}

function SurveyCard({ s, onOpen, onMove }: { s: Survey; onOpen: () => void; onMove: (to: SurveyStatus) => void }) {
  const pct = s.completes / s.target;
  return (
    <motion.article layout layoutId={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18 }}
      className="group rounded-xl border hairline bg-surface p-3 shadow-panel transition-shadow hover:shadow-lift">
      <div className="mb-1.5 flex items-center gap-1.5">
        <SurveySourceChip source={s.source} partner={s.partner} />
        <span className="font-mono text-[10.5px] text-ink-3">{s.ref}</span>
        {s.priority === 1 && <Badge tone="orange" className="ml-auto">P1</Badge>}
        <Menu>
          <MenuTrigger asChild><Button size="icon-sm" variant="ghost" className={cn(s.priority !== 1 && 'ml-auto')} aria-label={`Actions for ${s.title}`}><MoreHorizontal size={13} /></Button></MenuTrigger>
          <MenuContent>
            <MenuLabel>Move to</MenuLabel>
            {moves[s.status].length === 0 && <MenuItem>No moves from {s.status}</MenuItem>}
            {moves[s.status].map((to) => <MenuItem key={to} danger={to === 'closed'} onSelect={() => onMove(to)}>{columns.find((c) => c.id === to)!.label}</MenuItem>)}
            <MenuSeparator />
            <MenuItem onSelect={onOpen}>Open details</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <button onClick={onOpen} className="block w-full text-left">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug">{s.title}</h3>
        <div className="mt-0.5 text-2xs text-ink-3">{s.client} · {s.audience}</div>
        <div className="mt-2 flex items-center justify-between gap-2"><CountryChips codes={s.countries} /><span className="flex gap-1.5">{s.panels.map((p) => <PanelChip key={p} panel={p} short />)}</span></div>
        <dl className="mt-2 grid grid-cols-3 gap-1 text-center">
          {[['CPI', fmtMoney(s.cpi, false)], ['IR', `${Math.round(s.ir * 100)}%`], ['LOI', `${s.loi}m`]].map(([k, v]) => (
            <div key={k} className="rounded-md bg-surface-2/50 py-1"><dt className="text-[9.5px] uppercase tracking-wider text-ink-3">{k}</dt><dd className="num text-[12px] font-semibold">{v}</dd></div>
          ))}
        </dl>
        {s.status !== 'draft' && s.status !== 'scheduled' && (
          <div className="mt-2"><div className="mb-1 flex justify-between text-2xs"><span className="text-ink-3">Completes</span><span className="num font-semibold">{fmtNum(s.completes)} / {fmtNum(s.target)}</span></div><Bar value={pct} tone={pct >= 1 ? 'emerald' : 'blue'} /></div>
        )}
        <div className="mt-2"><QuotaStrip s={s} /></div>
      </button>
    </motion.article>
  );
}

export default function SurveyInventory() {
  const toast = useOS((s) => s.toast);
  const view = (useOS((s) => s.prefs['view:surveys']) as 'board' | 'table' | undefined) ?? 'board';
  const setPref = useOS((s) => s.setPref);
  const [list, setList] = useState(seed);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<'all' | Survey['source']>('all');
  const [open, setOpen] = useState<Survey | null>(null);
  const [closing, setClosing] = useState<Survey | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return list.filter((s) => (src === 'all' || s.source === src) && (!t || `${s.title} ${s.client} ${s.ref}`.toLowerCase().includes(t)));
  }, [list, q, src]);
  const move = (s: Survey, to: SurveyStatus) => {
    if (to === 'closed') { setClosing(s); return; }
    setList((l) => l.map((x) => (x.id === s.id ? { ...x, status: to } : x)));
    toast(`${s.title} moved to ${to}`, 'ok');
  };
  const live = list.filter((s) => s.status === 'live');
  const atRisk = live.filter((s) => s.quotas.some((c) => paceBand(c.achieved, c.target, s.elapsed) === 'risk')).length;

  const cols: Column<Survey>[] = [
    { key: 'title', label: 'Survey', sort: (s) => s.title, render: (s) => <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{s.title}</span><span className="text-2xs text-ink-3">{s.client} · {s.ref}</span></span> },
    { key: 'source', label: 'Source', sort: (s) => s.source, render: (s) => <SurveySourceChip source={s.source} partner={s.partner} /> },
    { key: 'status', label: 'Status', sort: (s) => s.status, render: (s) => <StatusPill status={pill[s.status]} /> },
    { key: 'countries', label: 'Countries', render: (s) => <CountryChips codes={s.countries} /> },
    { key: 'cpi', label: 'CPI', align: 'right', sort: (s) => s.cpi, render: (s) => <span className="num">{fmtMoney(s.cpi, false)}</span> },
    { key: 'ir', label: 'IR', align: 'right', sort: (s) => s.ir, render: (s) => <span className="num">{Math.round(s.ir * 100)}%</span> },
    { key: 'loi', label: 'LOI', align: 'right', sort: (s) => s.loi, render: (s) => <span className="num">{s.loi}m</span> },
    { key: 'progress', label: 'Completes', align: 'right', sort: (s) => s.completes / s.target, render: (s) => <span className="num">{fmtNum(s.completes)} / {fmtNum(s.target)}</span> },
    { key: 'quota', label: 'Quota health', render: (s) => <QuotaStrip s={s} /> },
    { key: 'panels', label: 'Panels', optional: true, render: (s) => <span className="flex gap-1.5">{s.panels.map((p) => <PanelChip key={p} panel={p} short />)}</span> },
  ];

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Survey inventory" subtitle="Every survey panellists can be routed to, from PROJEXA, ZAPX and partner exchanges."
        actions={<Segmented label="Inventory view" size="sm" value={view} onChange={(v) => setPref('view:surveys', v)} options={[{ value: 'board', label: <span className="flex items-center gap-1"><LayoutGrid size={12} /> Board</span> }, { value: 'table', label: <span className="flex items-center gap-1"><Rows3 size={12} /> Table</span> }]} />} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search surveys, clients or refs…" className="w-full sm:w-72" />
        <Segmented label="Source" size="sm" value={src} onChange={setSrc} options={[{ value: 'all', label: 'All sources' }, { value: 'PROJEXA', label: 'PROJEXA' }, { value: 'ZAPX', label: 'ZAPX' }, { value: 'Partner', label: 'Partner' }]} />
        <span className="ml-auto text-2xs text-ink-3"><b className="num text-ink">{live.length}</b> live · <b className={cn('num', atRisk ? 'text-danger' : 'text-ink')}>{atRisk}</b> with a quota cell at risk</span>
      </div>

      {view === 'board' ? (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {columns.map((c) => {
            const items = rows.filter((s) => s.status === c.id);
            return (
              <section key={c.id} aria-label={`${c.label}, ${items.length} surveys`} className="w-[272px] shrink-0 snap-start rounded-2xl bg-surface-2/25 p-2">
                <header className="mb-2 flex items-center gap-2 px-1 text-[12.5px] font-semibold"><StatusDot status={pill[c.id]} label={c.label} /><span className="num text-2xs text-ink-3">{items.length}</span></header>
                <div className="max-h-[calc(100vh-260px)] min-h-[200px] space-y-2 overflow-y-auto pr-0.5">
                  <AnimatePresence initial={false}>{items.map((s) => <SurveyCard key={s.id} s={s} onOpen={() => setOpen(s)} onMove={(to) => move(s, to)} />)}</AnimatePresence>
                  {items.length === 0 && <p className="rounded-xl border border-dashed hairline py-6 text-center text-2xs text-ink-3">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Panel className="p-0"><DataTable caption="Survey inventory" rows={rows} columns={cols} getId={(s) => s.id} onOpen={setOpen} prefKey="surveys" initialSort={{ key: 'progress', dir: 'asc' }} /></Panel>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} subtitle={open && `${open.client} · ${open.ref}`} width={520}>
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><StatusPill status={pill[open.status]} /><SurveySourceChip source={open.source} partner={open.partner} /><CountryChips codes={open.countries} max={6} /></div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[['CPI', fmtMoney(open.cpi, false)], ['IR', `${Math.round(open.ir * 100)}%`], ['LOI', `${open.loi} min`], ['Target', fmtNum(open.target)], ['Completes', fmtNum(open.completes)], ['Drop-off', `${Math.round(open.dropoff * 100)}%`]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">{k}</dt><dd className="num text-[15px] font-semibold">{v}</dd></div>
              ))}
            </dl>
            <section>
              <SectionTitle title="Quota cells" eyebrow={`${open.quotas.length} cells`} />
              <ul className="space-y-1.5">
                {open.quotas.map((c) => { const b = paceBand(c.achieved, c.target, open.elapsed); return (
                  <li key={c.id} className="flex items-center gap-2 text-[12.5px]"><span className="w-28 truncate text-ink-3">{c.dim}</span><span className="flex-1 truncate">{c.label}</span><span className="num w-20 text-right">{c.achieved}/{c.target}</span><span className={cn('w-20 text-right text-2xs font-semibold', paceMeta[b].text)}>{paceMeta[b].label}</span></li>
                ); })}
              </ul>
            </section>
            <div className="flex flex-wrap gap-2">
              <Link href={`/supply/launch?s=${open.id}`} className={buttonVariants({ size: 'sm' })}><Rocket size={13} /> Launch</Link>
              <Link href={`/supply/quotas?s=${open.id}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}><Target size={13} /> Quotas</Link>
              <Link href={`/supply/batches?s=${open.id}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}><CalendarClock size={13} /> Batches</Link>
              <Link href="/supply/routing" className={buttonVariants({ size: 'sm', variant: 'ghost' })}><Route size={13} /> Routing</Link>
              {open.status === 'live' && <Button size="sm" variant="ghost" onClick={() => { move(open, 'paused'); setOpen(null); }}><Pause size={13} /> Pause</Button>}
              {open.status === 'paused' && <Button size="sm" variant="ghost" onClick={() => { move(open, 'live'); setOpen(null); }}><Play size={13} /> Resume</Button>}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)} title={`Close ${closing?.title ?? 'survey'}?`}
        body={closing ? `Panellists can no longer enter this survey. ${fmtNum(closing.target - closing.completes)} completes are still open; anyone mid-survey will be allowed to finish.` : ''}
        confirmLabel="Close survey" onConfirm={() => { if (closing) { setList((l) => l.map((x) => (x.id === closing.id ? { ...x, status: 'closed' } : x))); toast(`${closing.title} closed`, 'warn'); } setClosing(null); }} />
    </div>
  );
}

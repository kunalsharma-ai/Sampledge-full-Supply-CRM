'use client';
/**
 * Screen 6 · Panellist Database Explorer. Facet rail + dense grid + peek drawer.
 * Saved views and visible columns persist per user. Bulk actions confirm before anything
 * irreversible. Live mode reads GET /panels/panelists with the same facets.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookmarkPlus, Boxes, Download, ExternalLink, Filter, Megaphone, ShieldOff, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Bar, Button, Drawer, Panel, SearchInput, buttonVariants, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { DataTable, type Column } from '@/components/ui/table';
import { StatusDot, type Status } from '@/components/ui/status';
import { PanelChip, SupplyHeader } from '@/components/supply/kit';
import { api } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { brandToApi, fromApiPanelist, panellists, SCALE, type Panellist } from '@/lib/supply/panellists';
import { encodeRoot, group, cond } from '@/lib/supply/audience';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const NONE: never[] = [];
const screen = screenBySlug('panellists')!;
type Facets = { brand: string[]; status: string[]; segment: string[]; country: string[]; minQuality: number; q: string };
const empty: Facets = { brand: [], status: [], segment: [], country: [], minQuality: 0, q: '' };
type View = { name: string; f: Facets };
const builtInViews: View[] = [
  { name: 'All panellists', f: empty },
  { name: 'Active HCPs', f: { ...empty, segment: ['hcp'], status: ['active'] } },
  { name: 'Profile gaps (active)', f: { ...empty, status: ['active'], minQuality: 0 } },
  { name: 'Dormant MFR members', f: { ...empty, brand: ['mfr'], status: ['dormant'] } },
];
const statusMap: Record<string, Status> = { active: 'active', dormant: 'paused', suspended: 'flagged', deletion_requested: 'closed' };
const PAGE = 50;

export default function PanellistExplorer() {
  const router = useRouter();
  const toast = useOS((s) => s.toast);
  const savedViews = useOS((s) => s.prefs['views:panellists'] as View[] | undefined) ?? NONE;
  const setPref = useOS((s) => s.setPref);
  const [f, setF] = useState<Facets>(empty);
  const [page, setPage] = useState(0);
  const [peek, setPeek] = useState<Panellist | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [confirm, setConfirm] = useState<{ ids: string[]; clear: () => void } | null>(null);
  const [suspended, setSuspended] = useState<Set<string>>(new Set());

  const data = useSupplyData(`panellists:${f.brand}:${f.status}:${f.segment}:${f.country}`, panellists, async () => {
    const qs = new URLSearchParams({ take: '200' });
    if (f.brand.length === 1) qs.set('brand', brandToApi[f.brand[0] as 't2o']);
    if (f.status.length === 1) qs.set('status', f.status[0]);
    if (f.country.length === 1) qs.set('country', f.country[0]);
    if (f.segment.length === 1) qs.set('segment', f.segment[0]);
    const r = await api<{ total: number; rows: Parameters<typeof fromApiPanelist>[0][] }>(`/panels/panelists?${qs}`);
    return r.rows.length ? r.rows.map(fromApiPanelist) : null;
  });
  const all = useMemo(() => data.data.map((p) => (suspended.has(p.id) ? { ...p, status: 'suspended' } : p)), [data.data, suspended]);
  const rows = useMemo(() => all.filter((p) =>
    (!f.brand.length || f.brand.includes(p.brand)) && (!f.status.length || f.status.includes(p.status)) && (!f.segment.length || f.segment.includes(p.segment)) &&
    (!f.country.length || f.country.includes(p.country)) && p.qualityScore * 100 >= f.minQuality && (!f.q || p.handle.includes(f.q.toLowerCase()) || p.id.includes(f.q))), [all, f]);
  const scale = data.source === 'live' ? 1 : SCALE;
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const set = (patch: Partial<Facets>) => { setF((x) => ({ ...x, ...patch })); setPage(0); };
  const active = f.brand.length + f.status.length + f.segment.length + f.country.length + (f.minQuality ? 1 : 0);

  const facet = (key: 'brand' | 'status' | 'segment' | 'country', label: string, opts: { v: string; l: string }[]) => (
    <fieldset className="space-y-0.5">
      <legend className="eyebrow mb-1.5">{label}</legend>
      {opts.map((o) => {
        const count = all.filter((p) => (p as unknown as Record<string, string>)[key] === o.v).length;
        const on = f[key].includes(o.v);
        return (
          <label key={o.v} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-surface-2/50', on && 'bg-primary/10')}>
            <input type="checkbox" checked={on} onChange={() => set({ [key]: on ? f[key].filter((x) => x !== o.v) : [...f[key], o.v] } as Partial<Facets>)} className="accent-[rgb(var(--primary))]" />
            <span className="flex-1">{o.l}</span><span className="num text-2xs text-ink-3">{fmtCompact(count * scale)}</span>
          </label>
        );
      })}
    </fieldset>
  );

  const cols: Column<Panellist>[] = [
    { key: 'handle', label: 'Panellist', sort: (p) => p.handle, render: (p) => <span className="flex flex-col py-0.5"><span className="font-medium">{p.handle}</span><span className="font-mono text-[10.5px] text-ink-3">{p.id}</span></span> },
    { key: 'brand', label: 'Panel', sort: (p) => p.brand, render: (p) => <PanelChip panel={p.brand} short /> },
    { key: 'country', label: 'Country', sort: (p) => p.country, render: (p) => <span className="font-mono text-2xs font-semibold">{p.country}</span> },
    { key: 'demo', label: 'Age · gender', render: (p) => <span className="text-ink-2">{p.ageBand} · {p.gender}</span> },
    { key: 'segment', label: 'Segment', sort: (p) => p.segment, render: (p) => <span className="capitalize text-ink-2">{p.specialty ?? p.jobRole ?? p.segment}</span> },
    { key: 'status', label: 'Status', sort: (p) => p.status, render: (p) => <StatusDot status={statusMap[p.status] ?? 'draft'} label={p.status.replace('_', ' ')} /> },
    { key: 'profile', label: 'Profile', sort: (p) => p.profileCompletion, render: (p) => <span className="flex w-24 items-center gap-2"><Bar value={p.profileCompletion} tone={p.profileCompletion < 0.6 ? 'orange' : 'emerald'} className="h-1" /><span className="num text-2xs text-ink-3">{Math.round(p.profileCompletion * 100)}%</span></span> },
    { key: 'quality', label: 'Quality', align: 'right', sort: (p) => p.qualityScore, render: (p) => <span className={cn(p.qualityScore < 0.6 && 'text-danger')}>{Math.round(p.qualityScore * 100)}</span> },
    { key: 'surveys', label: 'Surveys', align: 'right', sort: (p) => p.surveysCompleted, render: (p) => p.surveysCompleted },
    { key: 'points', label: 'Points', align: 'right', sort: (p) => p.points, render: (p) => fmtNum(p.points), optional: true },
    { key: 'last', label: 'Last active', sort: (p) => p.lastActiveAt ?? '', render: (p) => <span className="text-2xs text-ink-3">{p.lastActiveAt ?? '—'}</span> },
    { key: 'risk', label: 'Risk', render: (p) => p.risk.length ? <Badge tone="danger">{p.risk[0]}</Badge> : <span className="text-ink-3">—</span>, optional: true },
    { key: 'device', label: 'Device', render: (p) => p.device, optional: true },
  ];

  const toAudience = (ids: string[]) => {
    const picked = all.filter((p) => ids.includes(p.id));
    const countries = [...new Set(picked.map((p) => p.country))];
    const brands = [...new Set(picked.map((p) => p.brand))];
    router.push(`/supply/segmentation?def=${encodeURIComponent(encodeRoot(group('AND', [cond('brand', brands), cond('country', countries), cond('status', ['active'])])))}`);
  };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={data.source} title="Panellists"
        subtitle={<>{fmtNum(Math.round(rows.length * scale))} {data.source === 'demo' ? 'estimated ' : ''}panellists match{data.source === 'demo' && <span className="text-ink-3"> (sample of {fmtNum(rows.length)} shown)</span>}. Identities are pseudonymous handles; no names or contact details are stored here.</>}
        actions={<>
          <Button size="sm" variant="ghost" onClick={() => setSaveOpen(true)} disabled={!active}><BookmarkPlus size={13} /> Save view</Button>
          <Button size="sm" onClick={() => toAudience(rows.slice(0, 500).map((p) => p.id))}><Boxes size={13} /> Build audience from filters</Button>
        </>} />

      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Saved views">
        {[...builtInViews, ...savedViews].map((v) => (
          <button key={v.name} onClick={() => { setF(v.f); setPage(0); }} className={cn('rounded-full border px-3 py-1 text-2xs font-semibold', JSON.stringify(v.f) === JSON.stringify(f) ? 'border-primary/60 bg-primary/10 text-ink' : 'hairline text-ink-2 hover:text-ink')}>{v.name}</button>
        ))}
        {savedViews.length > 0 && <button className="ml-1 text-2xs text-ink-3 hover:text-danger" onClick={() => setPref('views:panellists', [])}>Clear saved</button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <Panel className="h-fit space-y-4 p-4 lg:sticky lg:top-20">
          <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[13px] font-semibold"><Filter size={13} /> Filters</span>{active > 0 && <button className="text-2xs text-primary" onClick={() => set(empty)}>Reset ({active})</button>}</div>
          {facet('brand', 'Panel', [{ v: 't2o', l: 'Turn2Opinion' }, { v: 'mfr', l: 'MyFrequentRewards' }, { v: 'mho', l: 'MyHealthOpinions' }])}
          {facet('status', 'Status', [{ v: 'active', l: 'Active' }, { v: 'dormant', l: 'Dormant' }, { v: 'suspended', l: 'Suspended' }, { v: 'deletion_requested', l: 'Deletion requested' }])}
          {facet('segment', 'Segment', [{ v: 'consumer', l: 'Consumer' }, { v: 'professional', l: 'B2B professional' }, { v: 'hcp', l: 'Healthcare professional' }, { v: 'patient', l: 'Patient' }, { v: 'caregiver', l: 'Caregiver' }])}
          {facet('country', 'Country', ['US', 'GB', 'DE', 'IN', 'CA', 'FR', 'BR', 'AU'].map((c) => ({ v: c, l: c })))}
          <label className="block">
            <span className="eyebrow mb-1.5 flex justify-between">Min. quality <span className="num normal-case tracking-normal text-ink-2">{f.minQuality}</span></span>
            <input type="range" min={0} max={95} step={5} value={f.minQuality} onChange={(e) => set({ minQuality: Number(e.target.value) })} className="w-full accent-[rgb(var(--primary))]" />
          </label>
        </Panel>

        <Panel className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Search handle or ID" className="w-64" />
            {active > 0 && (
              <div className="flex flex-wrap gap-1">
                {(['brand', 'status', 'segment', 'country'] as const).flatMap((k) => f[k].map((v) => (
                  <button key={k + v} onClick={() => set({ [k]: f[k].filter((x) => x !== v) } as Partial<Facets>)} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-2xs font-medium">{v} <X size={10} /></button>
                )))}
              </div>
            )}
          </div>
          <DataTable caption="Panellists" rows={pageRows} columns={cols} getId={(p) => p.id} onOpen={setPeek} selectable prefKey="panellists" loading={data.loading}
            bulkActions={(ids, clear) => <>
              <Button size="xs" variant="subtle" onClick={() => toAudience(ids)}><Boxes size={12} /> Build audience</Button>
              <Button size="xs" variant="ghost" onClick={() => { toast(`Profile nudge queued for ${ids.length} panellists (demo, nothing sent)`, 'info'); clear(); }}><Megaphone size={12} /> Nudge profile</Button>
              <Button size="xs" variant="ghost" onClick={() => { toast(`Exported ${ids.length} pseudonymous rows (demo)`, 'info'); clear(); }}><Download size={12} /> Export</Button>
              <Button size="xs" variant="danger" onClick={() => setConfirm({ ids, clear })}><ShieldOff size={12} /> Suspend</Button>
            </>}
            empty={<div className="py-8 text-center text-[13px] text-ink-3">No panellists match these filters. <button className="text-primary" onClick={() => set(empty)}>Reset filters</button></div>} />
          <div className="mt-3 flex items-center justify-between text-2xs text-ink-3">
            <span>Rows {fmtNum(rows.length ? page * PAGE + 1 : 0)}–{fmtNum(Math.min(rows.length, (page + 1) * PAGE))} of {fmtNum(rows.length)}</span>
            <span className="flex gap-1">
              <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="num px-2 py-1">{page + 1} / {pages}</span>
              <Button size="xs" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </Panel>
      </div>

      <Drawer open={!!peek} onClose={() => setPeek(null)} title={peek?.handle ?? ''} subtitle={peek ? <span className="flex items-center gap-2"><PanelChip panel={peek.brand} /> · {peek.country} · {peek.id}</span> : null}>
        {peek && (
          <div className="space-y-4 text-[13px]">
            <dl className="grid grid-cols-2 gap-3">
              {[['Status', peek.status.replace('_', ' ')], ['Segment', peek.specialty ?? peek.jobRole ?? peek.segment], ['Age · gender', `${peek.ageBand} · ${peek.gender}`], ['Language', peek.language],
                ['Quality', `${Math.round(peek.qualityScore * 100)}/100`], ['Profile', `${Math.round(peek.profileCompletion * 100)}%`], ['Surveys', peek.surveysCompleted], ['Points', fmtNum(peek.points)], ['Joined', peek.joinedAt], ['Last active', peek.lastActiveAt ?? '—']].map(([k, v]) => (
                <div key={String(k)}><dt className="text-2xs text-ink-3">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>
              ))}
            </dl>
            <Link href={`/supply/panellists/${peek.id}`} className={buttonVariants({ variant: 'primary', size: 'sm' })}><ExternalLink size={13} /> Open 360° profile</Link>
          </div>
        )}
      </Drawer>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title="Save this view" description="Saved views keep your filters and appear above the table.">
          <input autoFocus className={inputCls} placeholder="e.g. Active cardiologists, US" value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && viewName.trim()) { setPref('views:panellists', [...savedViews, { name: viewName.trim(), f }]); setSaveOpen(false); setViewName(''); toast('View saved'); } }} />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={!viewName.trim()} onClick={() => { setPref('views:panellists', [...savedViews, { name: viewName.trim(), f }]); setSaveOpen(false); setViewName(''); toast('View saved'); }}>Save view</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title={`Suspend ${confirm?.ids.length ?? 0} panellists?`} confirmLabel="Suspend" typeToConfirm={confirm && confirm.ids.length > 5 ? `SUSPEND ${confirm.ids.length}` : undefined}
        body="They stop receiving invitations and cannot redeem until reinstated. Their points are held, not removed. In the demo this only changes the table."
        onConfirm={() => { if (!confirm) return; setSuspended((s) => new Set([...s, ...confirm.ids])); toast(`${confirm.ids.length} panellists suspended`, 'warn'); confirm.clear(); }} />
    </div>
  );
}

'use client';
/**
 * Screen 2 · Global Panel Intelligence. Where respondents are and where surveys are running, by
 * country. The 3D globe is optional: it starts in 2D when WebGL is missing or motion is reduced,
 * and the ranked country list beside it carries the same numbers for keyboard and screen-reader
 * use. Selecting a country opens a drawer with panel mix, reachability and the requests in field.
 * Integration: `GET /panels/analytics` (available, country split), `GET /sampleon/v1/audience-requests` (planned).
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Box, Clock, ExternalLink, Map as MapIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { GlobeArc, GlobePoint } from '@/components/three/globe-scene';
import { useResolvedTheme } from '@/components/charts/echart';
import { Bar, Drawer, buttonVariants, Panel, Segmented, Skeleton } from '@/components/ui/primitives';
import { Sparkline } from '@/components/ui/kpi';
import { GeoMap } from '@/components/supply/geo-map';
import { CountryChips, KpiTile, PanelChip, ProductChip, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { arcCoords, inSendWindow, markets, marketByCode, sampleonRequests, totalMembers, trafficArcs, type Market } from '@/lib/supply/connected';
import { panelBrands } from '@/lib/supply/demo';
import { screenBySlug } from '@/lib/supply/screens';
import { palette } from '@/lib/tokens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const GlobeScene = dynamic(() => import('@/components/three/globe-scene'), { ssr: false, loading: () => <Skeleton className="absolute inset-0 rounded-full !bg-transparent" /> });
const screen = screenBySlug('global-intelligence')!;
type Metric = 'reachable' | 'completes' | 'surveys' | 'members';
const metricMeta: Record<Metric, { label: string; get: (m: Market) => number; show: (n: number) => string }> = {
  reachable: { label: 'Reachable today', get: (m) => m.reachable, show: (n) => `${fmtCompact(n)} reachable` },
  completes: { label: 'Completes today', get: (m) => m.completesToday, show: (n) => `${fmtNum(n)} completes today` },
  surveys: { label: 'Live surveys', get: (m) => m.liveSurveys, show: (n) => `${n} live surveys` },
  members: { label: 'Members', get: totalMembers, show: (n) => `${fmtCompact(n)} members` },
};
const regionColor = { Americas: palette.blue, EMEA: palette.cyan, APAC: palette.emerald } as const;
const NOW_UTC = 15; // demo clock: 15:00 UTC

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export default function GlobalIntelligence() {
  const reduced = useOS((s) => s.motion === 'reduced');
  const theme = useResolvedTheme();
  const [metric, setMetric] = useState<Metric>('reachable');
  const [mode, setMode] = useState<'3d' | '2d'>('2d');
  const [gl, setGl] = useState(false);
  const [region, setRegion] = useState<'all' | Market['region']>('all');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { const ok = webglOK(); setGl(ok); if (ok && !reduced) setMode('3d'); }, [reduced]);

  const M = metricMeta[metric];
  const shown = useMemo(() => markets.filter((m) => region === 'all' || m.region === region).sort((a, b) => M.get(b) - M.get(a)), [region, M]);
  const maxV = Math.max(...shown.map(M.get), 1);
  const points: GlobePoint[] = shown.map((m) => ({ code: m.code, name: m.name, lat: m.lat, lon: m.lon, value: M.get(m), label: M.show(M.get(m)), color: regionColor[m.region] }));
  const liveArcs = trafficArcs.filter((a) => a.live && (region === 'all' || marketByCode[a.to]?.region === region));
  const arcs: GlobeArc[] = liveArcs.map(arcCoords);
  const sel = selected ? marketByCode[selected] : null;
  const inMarket = sel ? sampleonRequests.filter((r) => r.countries.includes(sel.code) && !['closed', 'rejected', 'cancelled'].includes(r.status)) : [];
  const liveMarkets = markets.filter((m) => m.liveSurveys > 0).length;
  const awake = markets.filter((m) => inSendWindow(NOW_UTC, m));
  const top = [...markets].sort((a, b) => b.delta - a.delta)[0];

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Global panel intelligence" subtitle="Where our respondents are, and where surveys are running right now. Pick a country for its panel mix, reachability and requests in field."
        actions={<Segmented label="View" size="sm" value={mode} onChange={(m) => (m === '3d' && !gl ? undefined : setMode(m))}
          options={[{ value: '3d', label: <span className="flex items-center gap-1"><Box size={12} />3D globe</span> }, { value: '2d', label: <span className="flex items-center gap-1"><MapIcon size={12} />2D map</span> }]} />} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Markets with live fieldwork" value={liveMarkets} format="int" hint={`Of ${markets.length} markets where we have panellists`} />
        <KpiTile label="Reachable today" value={markets.reduce((a, m) => a + m.reachable, 0)} format="compact" delta={0.012} hint="Active, consented, not fatigued, not on cooldown" />
        <KpiTile label="In the send window now" value={awake.reduce((a, m) => a + m.reachable, 0)} format="compact" hint={`Reachable panellists where it is between 08:00 and 21:00 local time at ${NOW_UTC}:00 UTC (${awake.length} markets)`} />
        <KpiTile label={`Fastest growing: ${top.name}`} value={top.delta} format="pct" hint="Change in completes per day over the last 14 days" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="relative overflow-hidden p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Segmented label="Metric" size="sm" value={metric} onChange={setMetric} options={(Object.keys(metricMeta) as Metric[]).map((k) => ({ value: k, label: metricMeta[k].label }))} />
            <Segmented label="Region" size="sm" className="ml-auto" value={region} onChange={setRegion} options={[{ value: 'all', label: 'World' }, { value: 'Americas', label: 'Americas' }, { value: 'EMEA', label: 'EMEA' }, { value: 'APAC', label: 'APAC' }]} />
          </div>
          <div className="relative h-[440px]">
            {mode === '3d' && gl
              ? <div className="absolute inset-0" role="img" aria-label={`3D globe of ${M.label.toLowerCase()} by country. The ranked list beside it has the same numbers.`}>
                  <GlobeScene points={points} arcs={arcs} selected={selected} onSelect={setSelected} dark={theme === 'dark'} reduced={reduced} active />
                </div>
              : <div className="flex h-full items-center"><GeoMap ariaLabel={`Map of ${M.label.toLowerCase()} by country`} selected={selected} onSelect={setSelected}
                  symbols={shown.map((m) => ({ code: m.code, name: m.name, lat: m.lat, lon: m.lon, value: M.get(m), label: M.show(M.get(m)) }))}
                  arcs={liveArcs.map((a) => ({ id: a.id, ...arcCoords(a), live: true }))} /></div>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-3">
            {mode === '3d' ? Object.entries(regionColor).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} aria-hidden />{k}</span>) : <span>Circle area is proportional to {M.label.toLowerCase()}.</span>}
            <span className="flex items-center gap-1.5"><span className="h-px w-5 bg-cyan" aria-hidden />{liveArcs.length} live request routes, from client to fieldwork market</span>
            {!gl && <span>WebGL is not available here, so the map is 2D.</span>}
          </div>
        </Panel>

        <Panel className="flex max-h-[560px] flex-col p-0">
          <div className="border-b hairline px-4 py-3"><SectionTitle eyebrow="Ranked" title={`${M.label} by country`} /></div>
          <ol className="flex-1 overflow-y-auto py-1" aria-label={`Countries ranked by ${M.label.toLowerCase()}`}>
            {shown.map((m, i) => (
              <li key={m.code}>
                <button onClick={() => setSelected(m.code)} aria-pressed={selected === m.code} className={cn('flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2/50', selected === m.code && 'bg-primary/[.07]')}>
                  <span className="num w-5 text-2xs text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[12.5px]"><span className="truncate font-medium">{m.name}</span><span className="num shrink-0 font-semibold">{metric === 'surveys' ? M.get(m) : fmtCompact(M.get(m))}</span></span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-ink-3/12"><span className="block h-full rounded-full" style={{ width: `${(M.get(m) / maxV) * 100}%`, background: regionColor[m.region] }} /></span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Drawer open={!!sel} onClose={() => setSelected(null)} width={440} title={sel?.name ?? ''} subtitle={sel ? `${sel.region} · UTC${sel.utcOffset >= 0 ? '+' : ''}${sel.utcOffset}` : undefined}>
        {sel && <CountryDetail m={sel} requests={inMarket} />}
      </Drawer>
    </div>
  );
}

function CountryDetail({ m, requests }: { m: Market; requests: typeof sampleonRequests }) {
  const all = totalMembers(m);
  const local = (((NOW_UTC + m.utcOffset) % 24) + 24) % 24;
  const open = inSendWindow(NOW_UTC, m);
  const steps = [['Members', all], ['Active 30 days', m.active], ['Research consent', m.consented], ['Reachable today', m.reachable]] as const;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[12.5px]"><Clock size={13} className="text-ink-3" aria-hidden />
        <span>{String(Math.floor(local)).padStart(2, '0')}:{local % 1 ? '30' : '00'} local.</span>
        <span className={open ? 'text-emerald' : 'text-ink-3'}>{open ? 'Inside the send window' : 'Quiet hours: invitations wait until 08:00'}</span>
      </div>

      <section>
        <h3 className="eyebrow mb-2">Panel mix</h3>
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={panelBrands.map((b) => `${b.short} ${Math.round((m.members[b.id] / all) * 100)}%`).join(', ')}>
          {panelBrands.map((b) => <span key={b.id} style={{ width: `${(m.members[b.id] / all) * 100}%`, background: b.color }} />)}
        </div>
        <ul className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
          {panelBrands.map((b) => <li key={b.id}><PanelChip panel={b.id} short /><div className="num mt-0.5 font-semibold">{fmtCompact(m.members[b.id])}</div></li>)}
        </ul>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Reachability</h3>
        <ul className="space-y-2">
          {steps.map(([label, v]) => (
            <li key={label} className="text-[12px]">
              <div className="flex justify-between"><span className="text-ink-2">{label}</span><span className="num font-semibold">{fmtNum(v)} <span className="font-normal text-ink-3">{((v / all) * 100).toFixed(0)}%</span></span></div>
              <Bar value={v / all} tone="cyan" className="mt-1" />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="eyebrow mb-1">Completes per day, 14 days</h3>
        <Sparkline data={m.trend} height={44} color="rgb(var(--chart-2))" />
        <p className="text-2xs text-ink-3">{fmtNum(m.completesToday)} today · average IR {fmt.pct(m.ir)}</p>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Requests in field here ({requests.length})</h3>
        <ul className="space-y-2">
          {requests.map((r) => {
            const cells = r.quotas.filter((q) => q.country === m.code);
            const done = cells.reduce((a, q) => a + q.completes, 0), target = cells.reduce((a, q) => a + q.target, 0);
            return (
              <li key={r.id} className="rounded-xl border hairline p-2.5">
                <div className="flex items-center gap-2"><ProductChip product={r.platform === 'PROJEXA' ? 'projexa' : 'zapx'} /><span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{r.title}</span><CountryChips codes={r.countries} max={3} /></div>
                {target > 0 && <div className="mt-2 text-2xs text-ink-3"><div className="flex justify-between"><span>{m.code} quota cells</span><span className="num">{fmtNum(done)} / {fmtNum(target)}</span></div><Bar value={done / target} className="mt-1" /></div>}
                <Link href={`/supply/sampleon?r=${r.id}`} className="mt-1.5 inline-flex items-center gap-1 text-2xs text-primary hover:underline">Open in SAMPLEON allocation <ExternalLink size={10} aria-hidden /></Link>
              </li>
            );
          })}
          {requests.length === 0 && <li className="text-2xs text-ink-3">No requests in field in {m.name}.</li>}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} href={`/supply/distribution?c=${m.code}`}>Distribution and send windows</Link>
        <Link className={buttonVariants({ size: 'sm', variant: 'ghost' })} href="/supply/feasibility">Check feasibility</Link>
      </div>
    </div>
  );
}

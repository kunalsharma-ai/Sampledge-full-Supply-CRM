'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { Box, Map as MapIcon, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import landDots from '@/lib/geo/land-dots.json';
import { clients, countryActivity, vendors, countryByCode } from '@/lib/core';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { fmtCompact, fmtMoney } from '@/lib/utils';
import { useResolvedTheme } from '@/components/charts/echart';
import { Badge, Bar, Button, Segmented, Skeleton } from '@/components/ui/primitives';
import type { GlobeArc, GlobePoint } from './globe-scene';

const GlobeScene = dynamic(() => import('./globe-scene'), { ssr: false, loading: () => <Skeleton className="absolute inset-0 rounded-full !bg-transparent" /> });

type Metric = 'live' | 'completes' | 'suppliers' | 'demand';
const metricLabel: Record<Metric, string> = { live: 'Live projects', completes: 'Respondent completes', suppliers: 'Supplier coverage', demand: 'Research demand ($)' };

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** 2D accessible alternative: equirectangular projection of the same data. */
function FlatMap({ points, selected, onSelect }: { points: GlobePoint[]; selected: string | null; onSelect: (c: string) => void }) {
  const d = landDots as number[];
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (lon: number) => ((lon + 180) / 360) * 720, y = (lat: number) => ((80 - lat) / 140) * 280;
  return (
    <svg viewBox="0 0 720 300" className="h-full w-full" role="img" aria-label="Flat map of research activity by country">
      {Array.from({ length: d.length / 2 }, (_, i) => <circle key={i} cx={x(d[i * 2 + 1])} cy={y(d[i * 2])} r={0.9} fill="rgb(var(--ink-3) / 0.45)" />)}
      {points.map((p) => (
        <g key={p.code} onClick={() => onSelect(p.code)} className="cursor-pointer" role="button" aria-label={`${p.name}: ${p.label}`} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(p.code)}>
          <circle cx={x(p.lon)} cy={y(p.lat)} r={4 + (p.value / max) * 16} fill={p.code === selected ? palette.magenta : palette.cyan} opacity={0.28} />
          <circle cx={x(p.lon)} cy={y(p.lat)} r={2.6} fill={p.code === selected ? palette.magenta : palette.cyan} />
        </g>
      ))}
    </svg>
  );
}

export function GlobeExplorer({ height = 520 }: { height?: number }) {
  const projects = useOS((s) => s.projects);
  const reduced = useOS((s) => s.motion === 'reduced');
  const theme = useResolvedTheme();
  const [metric, setMetric] = useState<Metric>('live');
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const [selected, setSelected] = useState<string | null>(null);
  const [gl, setGl] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-80px' });

  useEffect(() => { const ok = webglOK(); setGl(ok); if (!ok) setMode('2d'); }, []);

  const activity = useMemo(() => countryActivity(projects), [projects]);
  const points: GlobePoint[] = activity
    .filter((c) => c.projects > 0 || metric === 'suppliers')
    .map((c) => {
      const f = 1;
      const raw = metric === 'live' ? c.live + c.projects * 0.25 : metric === 'completes' ? c.completes : metric === 'suppliers' ? c.suppliers : c.demand;
      const value = raw * f;
      const label = metric === 'live' ? `${c.live} live · ${c.projects} total projects` : metric === 'completes' ? `${fmtCompact(Math.round(c.completes * f))} completes` : metric === 'suppliers' ? `${c.suppliers} suppliers` : `${fmtMoney(c.demand * f)} demand`;
      return { code: c.code, name: c.name, lat: c.lat, lon: c.lon, value, label, color: c.region === 'APAC' ? palette.emerald : c.region === 'EMEA' ? palette.cyan : palette.blue };
    });

  const arcs: GlobeArc[] = useMemo(() => {
    const live = projects.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
    const out: GlobeArc[] = [];
    live.forEach((p) => p.vendors.slice(0, 1).forEach((vid) => {
      const v = vendors.find((x) => x.id === vid)!;
      const from = countryByCode[v.hq];
      p.countries.forEach((cc) => { const to = countryByCode[cc]; if (from && to && from.code !== to.code) out.push({ from: [from.lat, from.lon], to: [to.lat, to.lon], weight: Math.min(1, p.completes / 1500) }); });
    }));
    return out.slice(0, 18);
  }, [projects]);

  const sel = activity.find((c) => c.code === selected);
  const selProjects = sel ? projects.filter((p) => sel.projectIds.includes(p.id)) : [];

  return (
    <div ref={ref} className="relative overflow-hidden" style={{ height }}>
      <div className="absolute left-0 right-0 top-0 z-10 flex flex-wrap items-center gap-2">
        <Segmented size="sm" label="globe-metric" value={metric} onChange={setMetric} options={(Object.keys(metricLabel) as Metric[]).map((m) => ({ value: m, label: metricLabel[m] }))} />
        <div className="ml-auto flex items-center gap-2">
          <Segmented size="sm" label="globe-mode" value={mode} onChange={(m) => (m === '3d' && !gl ? null : setMode(m))} options={[{ value: '3d', label: <span className="flex items-center gap-1"><Box size={11} />3D</span> }, { value: '2d', label: <span className="flex items-center gap-1"><MapIcon size={11} />2D</span> }]} />
        </div>
      </div>

      <div className="absolute inset-0 top-10 bottom-14">
        {mode === '3d' && gl ? (
          <GlobeScene points={points} arcs={arcs} selected={selected} onSelect={setSelected} dark={theme === 'dark'} reduced={reduced} active={inView} />
        ) : (
          <div className="flex h-full items-center"><FlatMap points={points} selected={selected} onSelect={setSelected} /></div>
        )}
        {!gl && <div className="absolute bottom-2 left-2 text-2xs text-ink-3">WebGL unavailable, showing 2D map.</div>}
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-10 rounded-xl border hairline bg-surface-2/50 px-3 py-2 text-2xs text-ink-3 backdrop-blur">
        Current position from {projects.length} project records and the supplier registry. Select a market for its projects.
      </div>

      <AnimatePresence>
        {sel && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="panel absolute bottom-16 right-0 top-12 z-20 flex w-[min(320px,90%)] flex-col p-4" role="dialog" aria-label={`${sel.name} details`}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="eyebrow">{sel.region}</div>
                <div className="font-display text-lg font-semibold">{sel.name}</div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(null)} aria-label="Close"><X size={14} /></Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">Live projects</div><div className="num font-jakarta text-lg font-bold">{sel.live}</div></div>
              <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">Suppliers</div><div className="num font-jakarta text-lg font-bold">{sel.suppliers}</div></div>
              <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">Completes</div><div className="num font-jakarta text-lg font-bold">{fmtCompact(sel.completes)}</div></div>
              <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">Demand</div><div className="num font-jakarta text-lg font-bold">{fmtMoney(sel.demand)}</div></div>
            </div>
            <div className="mt-3 text-2xs text-ink-3">Fieldwork progress</div>
            <Bar value={sel.target ? sel.completes / sel.target : 0} tone="cyan" className="mt-1" />
            <div className="eyebrow mb-1.5 mt-4">Projects in market</div>
            <ul className="-mx-1 flex-1 space-y-1 overflow-y-auto">
              {selProjects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects?open=${p.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-[12px] hover:bg-surface-2/60">
                    <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-2xs text-ink-3">{clients.find((c) => c.id === p.clientId)?.name} · {p.stage}</span></span>
                    <Badge tone={p.type === 'Healthcare' ? 'emerald' : p.type === 'B2B' ? 'purple' : 'blue'}>{p.type}</Badge>
                  </Link>
                </li>
              ))}
              {!selProjects.length && <li className="text-2xs text-ink-3">No projects in this market. Supplier coverage only.</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

'use client';
/**
 * Flat world map for SUPPLY360 (equirectangular, land as dots from Natural Earth 110m).
 * Used on its own (Global Audience Distribution) and as the 2D alternative to the 3D globe.
 * Symbols are sized by area (radius ∝ √value) so a country twice as large reads as twice as large;
 * a symbol can be split into panel segments. Every symbol is a keyboard-focusable button.
 */
import { memo } from 'react';
import landDots from '@/lib/geo/land-dots.json';
import { cn } from '@/lib/utils';

export type MapSymbol = { code: string; name: string; lat: number; lon: number; value: number; label: string; segments?: { color: string; value: number }[]; dim?: boolean };
export type MapArc = { id: string; from: [number, number]; to: [number, number]; live: boolean };

const W = 720, H = 300;
export const px = (lon: number) => ((lon + 180) / 360) * W;
export const py = (lat: number) => ((80 - lat) / 140) * H;

const Land = memo(function Land() {
  const d = landDots as number[];
  return <g aria-hidden>{Array.from({ length: d.length / 2 }, (_, i) => <circle key={i} cx={px(d[i * 2 + 1])} cy={py(d[i * 2])} r={0.9} fill="rgb(var(--ink-3) / 0.4)" />)}</g>;
});

function arcPath(a: MapArc) {
  const [x1, y1] = [px(a.from[1]), py(a.from[0])], [x2, y2] = [px(a.to[1]), py(a.to[0])];
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.25;
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
}

function donut(cx: number, cy: number, rad: number, segs: { color: string; value: number }[]) {
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  let a0 = -Math.PI / 2;
  return segs.filter((s) => s.value > 0).map((s, i) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = s.value >= total ? `M${cx},${cy - rad} A${rad},${rad} 0 1 1 ${cx - 0.01},${cy - rad} Z` : `M${cx},${cy} L${cx + rad * Math.cos(a0)},${cy + rad * Math.sin(a0)} A${rad},${rad} 0 ${large} 1 ${cx + rad * Math.cos(a1)},${cy + rad * Math.sin(a1)} Z`;
    a0 = a1;
    return <path key={i} d={d} fill={s.color} />;
  });
}

export function GeoMap({ symbols, selected, onSelect, arcs = [], maxRadius = 22, labelTop = 6, ariaLabel, className, children }: {
  symbols: MapSymbol[]; selected: string | null; onSelect: (code: string) => void; arcs?: MapArc[]; maxRadius?: number; labelTop?: number; ariaLabel: string; className?: string; children?: React.ReactNode;
}) {
  const max = Math.max(...symbols.map((s) => s.value), 1);
  const rOf = (v: number) => 3 + Math.sqrt(v / max) * maxRadius;
  const top = new Set([...symbols].sort((a, b) => b.value - a.value).slice(0, labelTop).map((s) => s.code));
  const ordered = [...symbols].sort((a, b) => b.value - a.value); // big first so small ones stay clickable on top
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-full w-full', className)} role="group" aria-label={ariaLabel}>
      <Land />
      {children}
      <g aria-hidden fill="none">
        {arcs.map((a) => <path key={a.id} d={arcPath(a)} stroke={a.live ? 'rgb(var(--cyan))' : 'rgb(var(--ink-3))'} strokeOpacity={a.live ? 0.7 : 0.3} strokeWidth={a.live ? 1.2 : 0.8} strokeDasharray={a.live ? undefined : '3 3'} />)}
      </g>
      {ordered.map((s) => {
        const cx = px(s.lon), cy = py(s.lat), rad = rOf(s.value), sel = s.code === selected;
        return (
          <g key={s.code} role="button" tabIndex={0} aria-label={`${s.name}: ${s.label}`} aria-pressed={sel}
            onClick={() => onSelect(s.code)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.code); } }}
            className="cursor-pointer outline-none [&:focus-visible>circle.ring]:opacity-100" style={{ opacity: s.dim ? 0.3 : 1, transition: 'opacity .3s' }}>
            <title>{`${s.name}: ${s.label}`}</title>
            {s.segments
              ? <g opacity={0.85}>{donut(cx, cy, rad, s.segments)}</g>
              : <circle cx={cx} cy={cy} r={rad} fill="rgb(var(--primary))" opacity={0.32} />}
            <circle cx={cx} cy={cy} r={rad} fill="none" stroke={sel ? 'rgb(var(--ink))' : 'rgb(var(--surface))'} strokeWidth={sel ? 1.8 : 0.8} />
            <circle className="ring" cx={cx} cy={cy} r={rad + 3} fill="none" stroke="rgb(var(--primary))" strokeWidth={1.5} opacity={0} />
            {(top.has(s.code) || sel) && <text x={cx} y={cy + rad + 9} textAnchor="middle" fontSize={8.5} fontWeight={600} fill="rgb(var(--ink-2))" style={{ paintOrder: 'stroke', stroke: 'rgb(var(--bg))', strokeWidth: 2.5 }}>{s.code}</text>}
          </g>
        );
      })}
    </svg>
  );
}

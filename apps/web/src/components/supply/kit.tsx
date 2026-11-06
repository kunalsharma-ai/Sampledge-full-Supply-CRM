'use client';
/**
 * SUPPLY360 screen kit (Audience Orbit X): header, KPI tile, product and panel chips, country chips.
 * Screens compose these with the generic UI library in components/ui.
 */
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { DemoBadge } from '@/components/ui/primitives';
import { AnimatedNumber, Sparkline } from '@/components/ui/kpi';
import { Tip } from '@/components/ui/overlay';
import { brandColors, type Screen } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtMoney, fmtNum } from '@/lib/utils';
import type { Source as DataSource } from '@/lib/supply/data';

export function SupplyHeader({ screen, title, subtitle, actions, source = 'demo', children }: {
  screen?: Pick<Screen, 'group' | 'n'>; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; source?: DataSource | 'mixed'; children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <div className="eyebrow mb-1.5 flex flex-wrap items-center gap-2">
          {screen && <span>{screen.group}</span>}
          {source === 'demo' && <DemoBadge label="Demo data" />}
          {source === 'mixed' && <DemoBadge label="Partly demo data" />}
        </div>
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13.5px] text-ink-2">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export const fmt = {
  int: (n: number) => fmtNum(Math.round(n)),
  compact: (n: number) => fmtCompact(n),
  pct: (n: number) => `${(n * 100).toFixed(1)}%`,
  money: (n: number) => fmtMoney(n, n >= 100_000),
};

/** Compact KPI: label + hint, animated value (0.6s on change), delta coloured by whether up is good. */
export function KpiTile({ label, value, format, delta, good = 'up', spark, hint, href, color = 'rgb(var(--chart-1))', period = 'vs previous period' }: {
  label: string; value: number; format: keyof typeof fmt; delta?: number; good?: 'up' | 'down'; spark?: number[]; hint?: string; href?: string; color?: string; period?: string;
}) {
  const isGood = delta === undefined ? undefined : (delta >= 0) === (good === 'up');
  const body = (
    <div className="panel group flex h-full flex-col justify-between gap-2 p-4 transition-shadow duration-200 hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium leading-tight text-ink-2">{label}</span>
        {hint && <Tip content={hint}><span tabIndex={0} aria-label={`About ${label}`} className="text-ink-3 hover:text-ink"><Info size={12} /></span></Tip>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <AnimatedNumber value={value} format={fmt[format]} duration={0.6} className="font-jakarta text-[24px] font-bold leading-none tracking-tight" />
        {spark && <div className="w-[42%] max-w-[120px] shrink-0"><Sparkline data={spark} color={color} height={28} /></div>}
      </div>
      {delta !== undefined && (
        <div className="flex items-center gap-1 text-2xs">
          <span className={cn('inline-flex items-center gap-0.5 font-semibold', isGood ? 'text-emerald' : 'text-danger')}>
            {delta >= 0 ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
            <span className="sr-only">{delta >= 0 ? 'up' : 'down'}</span>{(Math.abs(delta) * 100).toFixed(1)}%
          </span>
          <span className="truncate text-ink-3">{period}</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-[1.25rem]" aria-label={`${label}: open`}>{body}</Link> : body;
}

/** Product identity chip: SAMPLEON, PROJEXA and ZAPX keep their own colours inside SUPPLY360. */
export function ProductChip({ product, children }: { product: 'sampleon' | 'projexa' | 'zapx'; children?: ReactNode }) {
  const b = brandColors[product];
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide ring-1 ring-inset"
      style={{ color: `color-mix(in srgb, ${b.color} 55%, rgb(var(--ink)))`, background: `color-mix(in srgb, ${b.color} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${b.color} 35%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: b.color }} aria-hidden />
      {children ?? b.name}
    </span>
  );
}

export function PanelChip({ panel, short }: { panel: 't2o' | 'mfr' | 'mho'; short?: boolean }) {
  const b = brandColors[panel];
  const abbr = { t2o: 'T2O', mfr: 'MFR', mho: 'MHO' }[panel];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2" title={b.name}>
      <span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden /> {short ? abbr : b.name}
    </span>
  );
}

export function CountryChips({ codes, max = 3 }: { codes: string[]; max?: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {codes.slice(0, max).map((c) => <span key={c} className="rounded bg-ink-3/12 px-1 font-mono text-[10.5px] font-semibold text-ink-2">{c}</span>)}
      {codes.length > max && <span className="text-2xs text-ink-3">+{codes.length - max}</span>}
    </span>
  );
}

export function SectionTitle({ title, eyebrow, actions, id }: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-0.5">{eyebrow}</div>}
        <h2 id={id} className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** Where a survey came from: PROJEXA and ZAPX keep their product colours, partner exchanges are neutral. */
export function SurveySourceChip({ source, partner }: { source: 'PROJEXA' | 'ZAPX' | 'Partner'; partner?: string }) {
  if (source === 'PROJEXA') return <ProductChip product="projexa" />;
  if (source === 'ZAPX') return <ProductChip product="zapx" />;
  return <span className="inline-flex items-center rounded-md bg-ink-3/12 px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-ink-2 ring-1 ring-inset ring-ink-3/25">{partner ?? 'Partner'}</span>;
}

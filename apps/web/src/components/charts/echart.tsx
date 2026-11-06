'use client';
import { useEffect, useRef, useState } from 'react';
import type { EChartsOption, ECharts } from 'echarts';
import { useOS } from '@/lib/store';
import { readTokens, resolveTheme, themeById, type ThemeId } from '@/lib/themes';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** The active Audience Orbit X theme id, following the OS when the preference is 'system'. */
export function useThemeId(): ThemeId {
  const pref = useOS((s) => s.theme);
  const [osLight, setOsLight] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const f = () => setOsLight(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return resolveTheme(pref, osLight);
}

/** Whether the active theme is dark or light (charts, 3D scenes). */
export function useResolvedTheme(): 'dark' | 'light' {
  return themeById(useThemeId()).mode;
}

export function chartBase(theme: 'dark' | 'light'): EChartsOption {
  const t = readTokens();
  return {
    color: t.series,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: t.ink2, fontSize: 11 },
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: `border-radius:12px;box-shadow:0 12px 32px -12px rgba(0,0,0,${theme === 'dark' ? 0.5 : 0.18})`,
    },
    legend: { textStyle: { color: t.ink2, fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, top: 0 },
  };
}
/** Axis styling helper so every chart reads as one system. */
export function axis(_theme: 'dark' | 'light', extra: Record<string, unknown> = {}) {
  const t = readTokens();
  return {
    axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
    axisLabel: { color: t.ink3, fontSize: 10.5 },
    splitLine: { lineStyle: { color: t.line, type: 'dashed' as const } },
    ...extra,
  };
}

/**
 * Canvas can't resolve CSS custom properties, so `rgb(var(--chart-3))` or `rgb(var(--danger) / .4)`
 * strings anywhere in an option are swapped for computed colours before ECharts sees them.
 */
const VAR_RE = /rgba?\(\s*var\(--([\w-]+)\)\s*(?:\/\s*([\d.]+%?)\s*)?\)/g;
export function resolveCssColors<T>(o: T, cs: CSSStyleDeclaration = getComputedStyle(document.documentElement)): T {
  if (typeof o === 'string') {
    if (!o.includes('var(--')) return o;
    return o.replace(VAR_RE, (m, name: string, a?: string) => {
      const raw = cs.getPropertyValue(`--${name}`).trim();
      if (!raw) return m;
      const ch = raw.split(/\s+/).join(',');
      return a ? `rgba(${ch},${a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : a})` : `rgb(${ch})`;
    }) as T;
  }
  if (Array.isArray(o)) return o.map((x) => resolveCssColors(x, cs)) as T;
  if (o && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = resolveCssColors(v, cs);
    return out as T;
  }
  return o;
}

type Props = {
  option: (theme: 'dark' | 'light') => EChartsOption;
  height?: number | string;
  className?: string;
  onClick?: (p: { name: string; seriesName?: string; dataIndex: number; data: unknown }) => void;
  ariaLabel: string;
  deps?: unknown[];
};

/** Lazy-loaded, theme-aware Apache ECharts wrapper with loading + error states. */
export function EChart({ option, height = 260, className, onClick, ariaLabel, deps = [] }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const theme = useResolvedTheme();
  const themeId = useThemeId();
  const reduced = useOS((s) => s.motion === 'reduced');
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    import('echarts')
      .then((ec) => {
        if (disposed || !el.current) return;
        chart.current = ec.init(el.current, undefined, { renderer: 'canvas' });
        chart.current.on('click', (p) => clickRef.current?.(p as never));
        ro = new ResizeObserver(() => chart.current?.resize());
        ro.observe(el.current);
        setState('ready');
      })
      .catch(() => setState('error'));
    return () => { disposed = true; ro?.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    if (state !== 'ready' || !chart.current) return;
    const base = chartBase(theme);
    const o = resolveCssColors(option(theme));
    chart.current.setOption({ ...base, animation: !reduced, animationDuration: 900, animationEasing: 'cubicOut', ...o, tooltip: o.tooltip === undefined ? base.tooltip : { ...(base.tooltip as object), ...(o.tooltip as object) }, legend: o.legend === undefined ? undefined : Array.isArray(o.legend) ? o.legend : { ...(base.legend as object), ...(o.legend as object) } }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, theme, themeId, reduced, ...deps]);

  if (state === 'error') return <ErrorState title="Chart failed to load" body="The visualisation library could not be loaded." />;
  return (
    <div className={cn('relative', className)} style={{ height }}>
      {state === 'loading' && <Skeleton className="absolute inset-0" />}
      <div ref={el} role="img" aria-label={ariaLabel} className="h-full w-full" />
    </div>
  );
}

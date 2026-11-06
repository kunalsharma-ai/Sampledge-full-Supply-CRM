'use client';
import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useOS } from '@/lib/store';

/** Counts up to `value` once in view. Respects reduced motion. */
export function AnimatedNumber({ value, format, className, duration = 1.4 }: { value: number; format: (n: number) => string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useOS((s) => s.motion === 'reduced');
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (!inView) return;
    if (reduced) { mv.set(value); return; }
    const c = animate(mv, value, { duration, ease: [0.2, 0.8, 0.2, 1] });
    return () => c.stop();
  }, [inView, value, reduced, mv, duration]);
  return <motion.span ref={ref} className={cn('num', className)}>{text}</motion.span>;
}

export function Sparkline({ data, color = 'rgb(var(--cyan))', height = 36, className, fill = true }: { data: number[]; color?: string; height?: number; className?: string; fill?: boolean }) {
  const id = useId().replace(/:/g, '');
  const w = 120;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 3 - ((v - min) / (max - min || 1)) * (height - 6)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn('w-full', className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#sg${id})`} />}
      <motion.path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.4} fill={color} />
    </svg>
  );
}

export type KpiProps = {
  label: string;
  value: number;
  format: (n: number) => string;
  delta?: number; // fractional change vs comparison period
  deltaGoodWhen?: 'up' | 'down';
  period?: string;
  spark?: number[];
  status?: { tone: 'ok' | 'warn' | 'risk'; text: string };
  href?: string;
  tooltip?: string;
  color?: string;
  redacted?: boolean;
  index?: number;
};

/** Depth-aware KPI card: animated value, period delta, sparkline, status, tooltip, drill-down, refresh. */
export function KpiCard({ label, value, format, delta, deltaGoodWhen = 'up', period = 'vs prior 30d', spark, status, href, tooltip, color = 'rgb(var(--cyan))', redacted, index = 0 }: KpiProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const good = delta === undefined ? undefined : (delta >= 0) === (deltaGoodWhen === 'up');
  const ref = useRef<HTMLDivElement>(null);

  // pointer-tracked tilt + light (subtle depth, disabled under reduced motion via CSS transition cut)
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${x * 100}%`); el.style.setProperty('--my', `${y * 100}%`);
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 4}deg) rotateY(${(x - 0.5) * 5}deg)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = ''; };

  const body = (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="panel group relative h-full overflow-hidden p-4 transition-transform duration-300 will-change-transform"
      style={{ animationDelay: `${index * 40}ms` }}
      title={tooltip}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(240px circle at var(--mx,50%) var(--my,50%), color-mix(in srgb, ${color} 16%, transparent), transparent 60%)` }} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-[12px] font-medium text-ink-2">{label}</div>
        <div className="flex items-center gap-1">
          {status && (
            <span className={cn('h-1.5 w-1.5 rounded-full', status.tone === 'ok' ? 'bg-emerald' : status.tone === 'warn' ? 'bg-warn' : 'bg-danger')} title={status.text} aria-label={status.text} />
          )}
          <button
            aria-label={`Refresh ${label}`}
            onClick={(e) => { e.preventDefault(); setRefreshing(true); setTimeout(() => { setRefreshing(false); setTick((t) => t + 1); }, 650); }}
            className="rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus:opacity-100"
          >
            <RefreshCw size={11} className={cn(refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          {redacted ? (
            <div className="font-jakarta text-[22px] font-bold text-ink-3" title="Hidden for your role">•••</div>
          ) : refreshing ? (
            <div className="skeleton mt-1 h-7 w-24" />
          ) : (
            <AnimatedNumber key={tick} value={value} format={format} className="font-jakarta text-[24px] font-bold tracking-tight" />
          )}
        </div>
        {spark && !redacted && <div className="w-[46%] shrink-0 pb-1"><Sparkline data={spark} color={color} height={30} /></div>}
      </div>
      <div className="relative mt-1.5 flex min-h-[16px] items-center gap-1 text-2xs">
        {redacted ? <span className="text-ink-3">Hidden for your role</span> : delta !== undefined ? (
          <>
            <span className={cn('flex items-center gap-0.5 font-semibold', good ? 'text-emerald' : 'text-danger')}>
              {delta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{(Math.abs(delta) * 100).toFixed(1)}%
            </span>
            <span className="truncate text-ink-3">{period}</span>
          </>
        ) : status ? <span className="truncate text-ink-3">{status.text}</span> : null}
      </div>
      {href && <ChevronRight size={14} className="absolute bottom-3 right-3 text-ink-3 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-[1.25rem] animate-fade-up" aria-label={`${label}: open details`}>{body}</Link> : <div className="h-full animate-fade-up">{body}</div>;
}

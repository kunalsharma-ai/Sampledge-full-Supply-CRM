'use client';
/**
 * Supply Orbit: the Audience Orbit X signature visual. Each ring is one stage of the respondent
 * funnel (outer = registered, inner = reachable today); the lit arc is that stage's share of all
 * registered panellists. Hover or focus a ring (or its legend row) to read the stage-to-stage
 * conversion. Arcs draw in once; nothing moves afterwards.
 */
import { motion } from 'motion/react';
import { useState } from 'react';
import { useOS } from '@/lib/store';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

export type OrbitStage = { key: string; label: string; value: number; color: string };

export function SupplyOrbit({ stages, size = 280 }: { stages: OrbitStage[]; size?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const reduced = useOS((s) => s.motion === 'reduced');
  const total = stages[0]?.value || 1;
  const c = size / 2;
  const gap = 14;
  const outer = c - 8;
  const focus = stages.find((s) => s.key === hover) ?? stages[stages.length - 1];
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Respondent funnel: ${stages.map((s) => `${s.label} ${fmtNum(s.value)}`).join(', ')}`}>
          {stages.map((s, i) => {
            const r = outer - i * gap;
            const len = 2 * Math.PI * r;
            const share = s.value / total;
            const dim = hover && hover !== s.key;
            return (
              <g key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
                <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(var(--line) / var(--line-alpha))" strokeWidth={8} />
                <motion.circle cx={c} cy={c} r={r} fill="none" stroke={`rgb(${s.color})`} strokeWidth={8} strokeLinecap="round"
                  transform={`rotate(-90 ${c} ${c})`} strokeDasharray={len}
                  initial={{ strokeDashoffset: reduced ? len * (1 - share) : len }} animate={{ strokeDashoffset: len * (1 - share), opacity: dim ? 0.3 : 1 }}
                  transition={{ strokeDashoffset: { duration: reduced ? 0 : 1, delay: reduced ? 0 : 0.08 * i, ease: [0.2, 0.8, 0.2, 1] }, opacity: { duration: 0.15 } }} />
                {/* wide invisible hit area */}
                <circle cx={c} cy={c} r={r} fill="none" stroke="transparent" strokeWidth={gap} />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="mx-auto max-w-[96px] text-[9.5px] font-semibold uppercase leading-tight tracking-wider text-ink-3">{focus.label}</div>
            <div className="num font-jakarta text-[22px] font-bold leading-tight tracking-tight">{fmtCompact(focus.value)}</div>
            <div className="text-[10px] text-ink-3">{((focus.value / total) * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
      <ol className="w-full min-w-0 flex-1 space-y-1 sm:min-w-[210px]" aria-label="Funnel stages">
        {stages.map((s, i) => {
          const prev = stages[i - 1];
          const conv = prev ? s.value / prev.value : 1;
          return (
            <li key={s.key}>
              <button onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(s.key)} onBlur={() => setHover(null)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors', focus.key === s.key ? 'bg-surface-2/60' : 'hover:bg-surface-2/40')}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `rgb(${s.color})` }} aria-hidden />
                <span className="flex-1 truncate text-[12.5px] text-ink-2">{s.label}</span>
                <span className="num text-[13px] font-semibold">{fmtCompact(s.value)}</span>
                <span className="num w-12 text-right text-2xs text-ink-3">{prev ? `${(conv * 100).toFixed(0)}%` : '—'}</span>
              </button>
            </li>
          );
        })}
        <li className="px-2 pt-1 text-2xs text-ink-3">Right column: conversion from the stage above.</li>
      </ol>
    </div>
  );
}

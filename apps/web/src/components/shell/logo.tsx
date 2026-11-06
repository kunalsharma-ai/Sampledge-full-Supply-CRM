'use client';
import { useId } from 'react';
import Link from 'next/link';

/**
 * PLACEHOLDER wordmark. No official Sampledge logo files were provided for this phase.
 * Drop the official SVG into /public/brand/sampledge-logo.svg and swap this component;
 * nothing else references the mark directly.
 */
export function Logo({ compact }: { compact?: boolean }) {
  const gid = `lg-${useId().replace(/:/g, '')}`;
  return (
    <Link href="/supply/executive" className="flex items-center gap-2.5" aria-label="SUPPLY360 home">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'rgb(var(--cyan))' }} />
            <stop offset=".5" style={{ stopColor: 'rgb(var(--primary))' }} />
            <stop offset="1" style={{ stopColor: 'rgb(var(--primary-2))' }} />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${gid})`} opacity=".18" />
        <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke={`url(#${gid})`} strokeWidth="1.2" />
        <path d="M21.5 10.5c-1.3-1.3-3.2-2-5.4-2-3.3 0-5.6 1.7-5.6 4.2 0 5.4 11 3.1 11 8.4 0 2.4-2.4 4.2-5.8 4.2-2.4 0-4.5-.8-5.9-2.3" fill="none" stroke={`url(#${gid})`} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="flex flex-col gap-1">
          <span className="block font-display text-[15px] font-bold leading-[1.15] tracking-tight">Sampledge</span>
          <span className="block text-[9.5px] leading-none font-semibold uppercase tracking-[0.2em] text-ink-3">SUPPLY360 · Orbit X</span>
        </span>
      )}
    </Link>
  );
}

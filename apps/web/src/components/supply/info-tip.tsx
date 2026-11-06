'use client';
/**
 * The "i" button next to screen and section titles. Opens a small panel with what the thing is for,
 * how to use it, and where it fits. Text comes from lib/supply/help.ts.
 * A real button (keyboard and screen-reader reachable), 24px target, closes with Escape.
 */
import Link from 'next/link';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay';
import type { HelpEntry } from '@/lib/supply/help';
import { screenBySlug } from '@/lib/supply/screens';
import { cn } from '@/lib/utils';

export function InfoTip({ entry, label, size = 'sm', className }: { entry?: HelpEntry; label: string; size?: 'sm' | 'md'; className?: string }) {
  if (!entry) return null;
  const related = (entry.related ?? []).map((s) => screenBySlug(s)).filter((s): s is NonNullable<typeof s> => !!s && !s.hidden);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`About ${label}`}
          className={cn('inline-grid h-6 w-6 shrink-0 place-items-center rounded-full align-middle text-ink-3 outline-none transition-colors hover:bg-ink-3/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary', className)}>
          <Info size={size === 'md' ? 17 : 14} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(340px,calc(100vw-2rem))] p-3.5 text-[12.5px] font-normal normal-case tracking-normal" aria-label={`About ${label}`}>
        <p className="font-display text-[13.5px] font-semibold text-ink">{label}</p>
        <p className="mt-1 leading-relaxed text-ink-2">{entry.what}</p>
        {entry.how?.length ? (
          <>
            <p className="mt-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-3">How to use it</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 leading-relaxed text-ink-2">{entry.how.map((h) => <li key={h}>{h}</li>)}</ol>
          </>
        ) : null}
        {entry.where && (
          <>
            <p className="mt-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-3">Where it fits</p>
            <p className="mt-1 leading-relaxed text-ink-2">{entry.where}</p>
          </>
        )}
        {related.length > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">Next:{related.map((s) => <Link key={s.slug} href={`/supply/${s.slug}`} className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-primary hover:underline">{s.label}</Link>)}</p>
        )}
        <Link href="/supply/guide" className="mt-2.5 block text-2xs font-medium text-primary hover:underline">All screens explained</Link>
      </PopoverContent>
    </Popover>
  );
}

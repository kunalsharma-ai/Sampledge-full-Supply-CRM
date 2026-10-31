'use client';
import type { ReactNode } from 'react';
import { PlugZap } from 'lucide-react';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button, EmptyState, ErrorState, Skeleton } from './primitives';

/** Gate for screens backed only by API records. Offline mode explains instead of simulating. */
export function LiveOnly({ what, children }: { what: string; children: ReactNode }) {
  const mode = useOS((s) => s.mode);
  const session = useOS((s) => s.session);
  if (mode === 'connecting') return <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (mode !== 'live' || !session) {
    return (
      <div className="panel mx-auto mt-10 max-w-xl p-8">
        <EmptyState icon={<PlugZap size={18} />} title="Needs the live API" body={`${what} are real records created by workflows on the server, so they are not simulated in the offline demo. Start the API (npm run dev) and sign in to use this screen.`} />
      </div>
    );
  }
  return <>{children}</>;
}

export function Loadable<T>({ q, empty, children }: { q: { data: T | null; error: string | null; loading: boolean; reload: () => void }; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (q.error) return <ErrorState body={q.error} onRetry={q.reload} />;
  if (!q.data) return <div className="space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>;
  if (empty?.(q.data)) return null;
  return <>{children(q.data)}</>;
}

export type Col<T> = { key: string; label: ReactNode; render: (r: T) => ReactNode; align?: 'right'; className?: string };

export function DataTable<T extends { id: string }>({ rows, cols, empty, dense }: { rows: T[]; cols: Col<T>[]; empty?: ReactNode; dense?: boolean }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>{cols.map((c) => <th key={c.key} scope="col" className={cn('border-b hairline px-2 pb-2 text-left text-2xs font-medium uppercase tracking-wider text-ink-3', c.align === 'right' && 'text-right')}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="group">
              {cols.map((c) => <td key={c.key} className={cn('border-b hairline px-2 align-middle group-last:border-0', dense ? 'py-1.5' : 'py-2.5', c.align === 'right' && 'num text-right', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Load more" under a paged list (see usePaged). Renders nothing once every row is loaded. */
export function LoadMore({ q, count, noun = 'rows' }: { q: { hasMore: boolean; loadingMore: boolean; more: () => void }; count?: number; noun?: string }) {
  if (!q.hasMore) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-3 text-[12px] text-ink-3">
      {count != null && <span>Showing {count} {noun}</span>}
      <Button size="sm" onClick={() => q.more()} disabled={q.loadingMore}>{q.loadingMore ? 'Loading…' : 'Load more'}</Button>
    </div>
  );
}

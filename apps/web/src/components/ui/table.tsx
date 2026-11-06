'use client';
/**
 * Audience Orbit X DataTable: sortable columns, row selection with a bulk-action bar, customisable
 * (persisted) columns, density-aware row height, keyboard navigation and loading/empty states.
 *
 * Keys while a row has focus: ↑/↓ or j/k move, Enter opens, x toggles selection, Esc clears selection.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Columns3, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button, EmptyState, Skeleton } from './primitives';
import { Popover, PopoverContent, PopoverTrigger, Switch } from './overlay';

export type Column<T> = {
  key: string;
  label: string;
  render: (r: T) => ReactNode;
  sort?: (r: T) => number | string;
  align?: 'right' | 'center';
  className?: string;
  /** Hidden by default; the user can turn it on from the Columns menu. */
  optional?: boolean;
};

export function DataTable<T>({ rows, columns, getId, onOpen, selectable, bulkActions, prefKey, loading, empty, caption, initialSort, className }: {
  rows: T[];
  columns: Column<T>[];
  getId: (r: T) => string;
  onOpen?: (r: T) => void;
  selectable?: boolean;
  bulkActions?: (ids: string[], clear: () => void) => ReactNode;
  /** Persists visible columns under this key. */
  prefKey?: string;
  loading?: boolean;
  empty?: ReactNode;
  caption: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  className?: string;
}) {
  const prefs = useOS((s) => (prefKey ? (s.prefs[`cols:${prefKey}`] as string[] | undefined) : undefined));
  const setPref = useOS((s) => s.setPref);
  const defaultCols = columns.filter((c) => !c.optional).map((c) => c.key);
  const visible = prefs ?? defaultCols;
  const cols = columns.filter((c) => visible.includes(c.key));
  const [sort, setSort] = useState(initialSort ?? null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const body = useRef<HTMLTableSectionElement>(null);

  const sorted = useMemo(() => {
    const c = sort && columns.find((x) => x.key === sort.key);
    if (!c?.sort) return rows;
    const f = c.sort;
    return [...rows].sort((a, b) => {
      const x = f(a), y = f(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort!.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = sorted.length > 0 && sorted.every((r) => sel.has(getId(r)));
  const clear = () => setSel(new Set());

  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, r: T) => {
    const rowsEls = Array.from(body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? []);
    const i = rowsEls.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); rowsEls[Math.min(rowsEls.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); rowsEls[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === 'Enter' && onOpen) { e.preventDefault(); onOpen(r); }
    else if (e.key === 'x' && selectable) { e.preventDefault(); toggle(getId(r)); }
    else if (e.key === 'Escape') clear();
  };

  return (
    <div className={cn('relative', className)}>
      {prefKey && (
        <div className="mb-2 flex justify-end">
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost" size="xs"><Columns3 size={13} /> Columns</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              <div className="mb-1 px-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">Visible columns</div>
              {columns.map((c) => (
                <label key={c.key} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-[13px]">
                  {c.label}
                  <Switch label={`Show ${c.label}`} checked={visible.includes(c.key)} onCheckedChange={(on) => setPref(`cols:${prefKey}`, on ? [...visible, c.key] : visible.filter((k) => k !== c.key))} />
                </label>
              ))}
              <button className="mt-1 w-full rounded-lg px-1 py-1 text-left text-2xs text-primary hover:underline" onClick={() => setPref(`cols:${prefKey}`, undefined)}>Reset to default</button>
            </PopoverContent>
          </Popover>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border hairline">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-[1] bg-surface-2/90 backdrop-blur">
            <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-ink-3">
              {selectable && (
                <th className="w-9 px-3"><input type="checkbox" aria-label="Select all rows" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(sorted.map(getId)))} className="accent-[rgb(var(--primary))]" /></th>
              )}
              {cols.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('h-9 whitespace-nowrap px-3 font-semibold', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                    {c.sort ? (
                      <button className={cn('inline-flex items-center gap-1 hover:text-ink', on && 'text-ink')} onClick={() => setSort(on && sort!.dir === 'desc' ? { key: c.key, dir: 'asc' } : { key: c.key, dir: 'desc' })}>
                        {c.label}{on && (sort!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={body}>
            {loading && Array.from({ length: 6 }, (_, i) => (
              <tr key={i} className="border-t hairline"><td colSpan={cols.length + (selectable ? 1 : 0)} className="px-3 py-2"><Skeleton className="h-4" /></td></tr>
            ))}
            {!loading && sorted.map((r) => {
              const id = getId(r);
              const on = sel.has(id);
              return (
                <tr key={id} data-row tabIndex={0} onKeyDown={(e) => onRowKey(e, r)} onClick={() => onOpen?.(r)}
                  className={cn('h-row border-t hairline outline-none transition-colors focus-visible:bg-primary/10 focus-visible:outline-none', onOpen && 'cursor-pointer hover:bg-surface-2/50', on && 'bg-primary/[.07]')}>
                  {selectable && (
                    <td className="px-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select row ${id}`} checked={on} onChange={() => toggle(id)} className="accent-[rgb(var(--primary))]" /></td>
                  )}
                  {cols.map((c) => <td key={c.key} className={cn('whitespace-nowrap px-3', c.align === 'right' && 'num text-right', c.align === 'center' && 'text-center', c.className)}>{c.render(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && <div className="p-4">{empty ?? <EmptyState title="Nothing here yet" body="Rows will appear here as soon as they match." />}</div>}
      </div>
      <AnimatePresence>
        {selectable && sel.size > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }}
            className="sticky bottom-3 z-10 mx-auto mt-3 flex w-fit items-center gap-2 rounded-2xl border hairline bg-surface px-3 py-2 shadow-lift" role="toolbar" aria-label="Bulk actions">
            <span className="num text-xs font-semibold">{sel.size} selected</span>
            <span className="h-4 w-px bg-ink-3/30" />
            {bulkActions?.([...sel], clear)}
            <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={clear}><X size={14} /></Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

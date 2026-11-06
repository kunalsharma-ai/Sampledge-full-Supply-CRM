'use client';
/**
 * Audience Orbit X form components: searchable multi-select (with country and language presets),
 * inline-validated text field and an autosave status indicator.
 */
import { Check, ChevronDown, CloudCheck, Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { inputCls } from './primitives';
import { Popover, PopoverContent, PopoverTrigger } from './overlay';

export type Option = { value: string; label: string; hint?: string; group?: string };

/** Searchable multi-select. Arrow keys move, Enter toggles, Backspace in an empty search removes the last chip. */
export function MultiSelect({ options, value, onChange, placeholder = 'Select…', label, max, className, invalid }: {
  options: Option[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string; max?: number; className?: string; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((o) => `${o.label} ${o.value} ${o.hint ?? ''}`.toLowerCase().includes(t)) : options).slice(0, 200);
  }, [q, options]);
  useEffect(() => setActive(0), [q]);
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!max || value.length < max) onChange([...value, v]);
  };
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[active]; if (o) toggle(o.value); }
    else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} aria-invalid={invalid || undefined}
          className={cn(inputCls, 'flex h-auto min-h-9 flex-wrap items-center gap-1 py-1 text-left', className)}>
          {value.length === 0 && <span className="text-ink-3">{placeholder}</span>}
          {value.slice(0, 6).map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-ink ring-1 ring-inset ring-primary/25">
              {byValue.get(v)?.label ?? v}
              <span role="button" tabIndex={-1} aria-label={`Remove ${byValue.get(v)?.label ?? v}`} onClick={(e) => { e.stopPropagation(); toggle(v); }} className="text-ink-3 hover:text-ink"><X size={10} /></span>
            </span>
          ))}
          {value.length > 6 && <span className="text-2xs text-ink-3">+{value.length - 6} more</span>}
          <ChevronDown size={14} className="ml-auto text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="flex items-center gap-2 border-b hairline px-3">
          <Search size={13} className="text-ink-3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={`Search ${label.toLowerCase()}…`}
            role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].value}` : undefined}
            className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-ink-3" />
          {value.length > 0 && <button className="text-2xs text-ink-3 hover:text-ink" onClick={() => onChange([])}>Clear</button>}
        </div>
        <ul id={listId} role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && <li className="px-3 py-4 text-center text-2xs text-ink-3">No matches for “{q}”</li>}
          {filtered.map((o, i) => {
            const on = value.includes(o.value);
            return (
              <li key={o.value} id={`${listId}-${o.value}`} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => toggle(o.value)}
                className={cn('flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]', i === active && 'bg-surface-2')}>
                <span className={cn('grid h-4 w-4 place-items-center rounded border', on ? 'border-primary bg-primary text-on-primary' : 'hairline')}>{on && <Check size={11} />}</span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-2xs text-ink-3">{o.hint}</span>}
              </li>
            );
          })}
        </ul>
        {max && <div className="border-t hairline px-3 py-1.5 text-2xs text-ink-3">{value.length}/{max} selected</div>}
      </PopoverContent>
    </Popover>
  );
}

export const COUNTRIES: Option[] = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['FR', 'France'], ['IN', 'India'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['JP', 'Japan'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['SE', 'Sweden'], ['PL', 'Poland'],
  ['ZA', 'South Africa'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['KR', 'South Korea'], ['ID', 'Indonesia'], ['PH', 'Philippines'],
  ['NG', 'Nigeria'], ['EG', 'Egypt'], ['TR', 'Türkiye'], ['AR', 'Argentina'], ['CO', 'Colombia'], ['CL', 'Chile'], ['SA', 'Saudi Arabia'],
].map(([value, label]) => ({ value, label, hint: value }));

export const LANGUAGES: Option[] = [
  ['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese (Simplified)'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['tr', 'Turkish'], ['pl', 'Polish'], ['sv', 'Swedish'], ['id', 'Indonesian'],
].map(([value, label]) => ({ value, label, hint: value }));

/** Text input with inline validation that appears after the first blur, never while typing the first time. */
export function ValidatedInput({ label, value, onChange, validate, hint, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; validate?: (v: string) => string | null; hint?: string; placeholder?: string; type?: string;
}) {
  const [touched, setTouched] = useState(false);
  const id = useId();
  const err = touched && validate ? validate(value) : null;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-ink-3">{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)}
        aria-invalid={!!err || undefined} aria-describedby={`${id}-msg`} className={inputCls} />
      <div id={`${id}-msg`} className={cn('mt-1 min-h-[14px] text-2xs', err ? 'text-danger' : 'text-ink-3')} aria-live="polite">{err ?? hint}</div>
    </div>
  );
}

/** Shows "Saving… / Saved" for autosaved forms. */
export function AutosaveStatus({ state, savedAt }: { state: 'idle' | 'saving' | 'saved'; savedAt?: Date | null }) {
  const label: ReactNode = state === 'saving' ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : state === 'saved' ? <><CloudCheck size={12} className="text-emerald" /> Saved{savedAt ? ` ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</> : null;
  return <span className="inline-flex items-center gap-1 text-2xs text-ink-3" aria-live="polite">{label}</span>;
}

/** Debounced autosave hook: calls `save` 700ms after the last change. */
export function useAutosave<T>(value: T, save: (v: T) => void | Promise<void>, enabled = true) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (first.current) { first.current = false; return; }
    setState('saving');
    const t = setTimeout(async () => { await save(value); setState('saved'); setSavedAt(new Date()); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value), enabled]);
  return { state, savedAt };
}

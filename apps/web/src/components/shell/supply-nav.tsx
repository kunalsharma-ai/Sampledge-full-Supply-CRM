'use client';
/**
 * SUPPLY360 navigation (Audience Orbit X). Nine collapsible groups from lib/supply/screens.ts, a
 * jump-to filter (press /), role-aware items, and the Research OS modules in their own section.
 * Expanded state persists per user. Collapsed rail shows one icon per group with a flyout.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { ChevronRight, Lock, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { access } from '@/lib/core';
import { isBuilt, modules } from '@/lib/modules';
import { useOS } from '@/lib/store';
import { brandColors, groups, isScreenBuilt, screenByPath, screenHref, visibleScreens, type NavGroup, type Screen } from '@/lib/supply/screens';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger, Tip } from '@/components/ui/overlay';
import { supplyIcon } from './supply-icons';
import { icons as moduleIcons } from './shell';

const RESEARCH = 'Research OS';

function Item({ s, active, onNavigate }: { s: Screen; active: boolean; onNavigate?: () => void }) {
  const role = useOS((st) => st.role);
  const Icon = supplyIcon(s.icon);
  const brand = s.brand && brandColors[s.brand];
  return (
    <Link href={screenHref(s)} onClick={onNavigate} aria-current={active ? 'page' : undefined}
      className={cn('group relative flex h-nav items-center gap-2.5 rounded-lg pl-3 pr-2 text-[13px] font-medium transition-colors', active ? 'text-ink' : 'text-ink-2 hover:bg-surface-2/50 hover:text-ink')}>
      {active && <motion.span layoutId="supply-nav-active" className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/25" transition={{ type: 'spring', bounce: 0.12, duration: 0.4 }} />}
      {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-primary" />}
      <Icon size={15} className={cn('relative shrink-0', active ? 'text-primary' : 'text-ink-3 group-hover:text-ink-2')} style={brand ? { color: brand.color } : undefined} />
      <span className="relative flex-1 truncate">{s.label}</span>
      {!isScreenBuilt(s) && <span className="relative h-1.5 w-1.5 rounded-full bg-ink-3/40" title={`Arrives in wave ${s.wave}`} aria-label="Design brief only" />}
      {access(role, s.module) === 'read' && <Lock size={10} className="relative text-ink-3" aria-label="Read only" />}
    </Link>
  );
}

export function SupplyNav({ collapsed, onNavigate, filterRef }: { collapsed?: boolean; onNavigate?: () => void; filterRef?: React.RefObject<HTMLInputElement | null> }) {
  const path = usePathname();
  const role = useOS((s) => s.role);
  const openPref = useOS((s) => s.prefs['nav:open'] as string[] | undefined);
  const setPref = useOS((s) => s.setPref);
  const [q, setQ] = useState('');
  const current = screenByPath(path);
  const allowed = useMemo(() => visibleScreens.filter((s) => access(role, s.module) !== 'none'), [role]);
  const research = modules.filter((m) => m.id !== 'design-system' && access(role, m.id) !== 'none' && isBuilt(m));
  const inResearch = research.some((m) => path?.startsWith(m.href));
  const open = new Set(openPref ?? ['Command', 'Respondents', 'Audiences', 'Surveys & fieldwork']);
  if (current) open.add(current.group);
  if (inResearch) open.add(RESEARCH);
  const toggle = (g: string) => { const n = new Set(open); if (n.has(g)) n.delete(g); else n.add(g); setPref('nav:open', [...n]); };

  const t = q.trim().toLowerCase();
  const matches = t ? allowed.filter((s) => `${s.label} ${s.summary} ${s.group}`.toLowerCase().includes(t)) : [];

  if (collapsed) {
    return (
      <nav aria-label="SUPPLY360" className="flex flex-col items-center gap-1 py-2">
        {groups.map((g) => {
          const items = allowed.filter((s) => s.group === g.id);
          if (!items.length) return null;
          const Icon = supplyIcon(g.icon);
          const on = current?.group === g.id;
          return (
            <Popover key={g.id}>
              <Tip content={g.id} side="right">
                <PopoverTrigger className={cn('grid h-9 w-9 place-items-center rounded-lg transition-colors', on ? 'bg-primary/15 text-primary' : 'text-ink-3 hover:bg-surface-2/60 hover:text-ink')} aria-label={g.id}>
                  <Icon size={17} />
                </PopoverTrigger>
              </Tip>
              <PopoverContent side="right" align="start" className="w-64 p-1.5">
                <div className="eyebrow px-2 pb-1 pt-1">{g.id}</div>
                {items.map((s) => <Item key={s.slug} s={s} active={current?.slug === s.slug} onNavigate={onNavigate} />)}
              </PopoverContent>
            </Popover>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="SUPPLY360" className="space-y-1">
      <label className="mx-1 mb-2 flex h-8 items-center gap-2 rounded-lg border hairline bg-surface-2/30 px-2.5 text-[12.5px] focus-within:border-primary/50">
        <Search size={13} className="shrink-0 text-ink-3" />
        <input ref={filterRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to screen" aria-label="Filter navigation"
          onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur(); } if (e.key === 'Enter' && matches[0]) { (e.currentTarget.closest('nav')?.querySelector('a[data-first]') as HTMLAnchorElement | null)?.click(); setQ(''); } }}
          className="w-full bg-transparent text-ink outline-none placeholder:text-ink-3" />
        {q ? <button aria-label="Clear filter" onClick={() => setQ('')}><X size={12} className="text-ink-3" /></button> : <kbd className="rounded border hairline px-1 text-[10px] text-ink-3">/</kbd>}
      </label>
      {t ? (
        <ul className="space-y-0.5">
          {matches.length === 0 && <li className="px-3 py-3 text-2xs text-ink-3">No screen matches “{q}”.</li>}
          {matches.map((s, i) => (
            <li key={s.slug}>
                <Link href={screenHref(s)} data-first={i === 0 ? '' : undefined} onClick={() => { setQ(''); onNavigate?.(); }}
                  className={cn('flex flex-col rounded-lg px-3 py-1.5 hover:bg-surface-2/60', i === 0 && 'bg-surface-2/40')}>
                  <span className="text-[13px] font-medium text-ink">{s.label}</span>
                  <span className="truncate text-2xs text-ink-3">{s.group}</span>
                </Link>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {groups.map((g) => {
            const items = allowed.filter((s) => s.group === g.id);
            if (!items.length) return null;
            return <Group key={g.id} id={g.id} open={open.has(g.id)} onToggle={() => toggle(g.id)}>
              {items.map((s) => <li key={s.slug}><Item s={s} active={current?.slug === s.slug} onNavigate={onNavigate} /></li>)}
            </Group>;
          })}
          {research.length > 0 && (
            <Group id={RESEARCH} open={open.has(RESEARCH)} onToggle={() => toggle(RESEARCH)}>
              {research.map((m) => {
                const Icon = moduleIcons[m.icon];
                const active = !!path?.startsWith(m.href);
                return (
                  <li key={m.id}>
                    <Link href={m.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                      className={cn('flex h-nav items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium', active ? 'bg-primary/10 text-ink' : 'text-ink-2 hover:bg-surface-2/50 hover:text-ink')}>
                      <Icon size={15} className={active ? 'text-primary' : 'text-ink-3'} /> <span className="flex-1 truncate">{m.label}</span>
                      {access(role, m.id) === 'read' && <Lock size={10} className="text-ink-3" aria-label="Read only" />}
                    </Link>
                  </li>
                );
              })}
            </Group>
          )}
        </>
      )}
    </nav>
  );
}

function Group({ id, open, onToggle, children }: { id: NavGroup | typeof RESEARCH; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const [h, setH] = useState<number | 'auto'>(open ? 'auto' : 0);
  useEffect(() => { setH(open ? 'auto' : 0); }, [open]);
  return (
    <div>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-[0.12em] text-ink-3 hover:text-ink-2">
        <ChevronRight size={11} className={cn('transition-transform duration-150', open && 'rotate-90')} /> {id}
      </button>
      <motion.ul initial={false} animate={{ height: h, opacity: open ? 1 : 0 }} transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }} className="space-y-0.5 overflow-hidden" inert={!open}>
        {children}
      </motion.ul>
    </div>
  );
}

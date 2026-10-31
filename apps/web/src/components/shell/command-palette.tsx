'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { modules } from '@/lib/modules';
import { access } from '@/lib/core';
import { useOS } from '@/lib/store';
import { vendors, clients } from '@/lib/core';
import { cn } from '@/lib/utils';

type Item = { id: string; group: string; label: string; hint?: string; run: () => void };

export function CommandPalette() {
  const open = useOS((s) => s.paletteOpen);
  const setOpen = useOS((s) => s.setPalette);
  const s = useOS();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(!useOS.getState().paletteOpen); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setOpen]);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => { router.push(href); setOpen(false); };
    const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? '';
    const all: Item[] = [
      ...modules.filter((m) => access(s.role, m.id) !== 'none').map((m) => ({ id: m.id, group: 'Modules', label: m.label, hint: m.blurb, run: go(m.href) })),
      ...s.projects.map((p) => ({ id: p.id, group: 'Projects', label: `${p.code} · ${p.name}`, hint: `${clientName(p.clientId)} · ${p.stage}`, run: go(`/projects?open=${p.id}`) })),
      ...s.opportunities.map((o) => ({ id: o.id, group: 'Opportunities', label: o.title, hint: `${clientName(o.clientId)} · ${o.stage}`, run: go(`/crm?open=${o.id}`) })),
      ...s.surveys.map((v) => ({ id: v.id, group: 'Surveys', label: v.name, hint: v.status, run: go(`/survey-studio${v.id === 'sv-cloud' ? '?tab=logic' : ''}`) })),
      ...vendors.map((v) => ({ id: v.id, group: 'Vendors', label: v.name, hint: `${v.coverage.length} markets · quality ${(v.quality * 100).toFixed(0)}`, run: go(`/marketplace?vendor=${v.id}`) })),
      { id: 'a-theme-d', group: 'Actions', label: 'Switch to Premium Dark', run: () => { s.setTheme('dark'); setOpen(false); } },
      { id: 'a-theme-l', group: 'Actions', label: 'Switch to Executive Light', run: () => { s.setTheme('light'); setOpen(false); } },
      { id: 'a-theme-s', group: 'Actions', label: 'Use Adaptive System theme', run: () => { s.setTheme('system'); setOpen(false); } },
      { id: 'a-motion', group: 'Actions', label: s.motion === 'full' ? 'Reduce motion' : 'Enable full motion', run: () => { s.setMotion(s.motion === 'full' ? 'reduced' : 'full'); setOpen(false); } },
      { id: 'a-ai', group: 'Actions', label: 'Ask Sampledge AI', run: () => { setOpen(false); s.setAssistant(true); } },
      { id: 'a-rfq', group: 'Actions', label: 'New RFQ', hint: 'Bidding CRM', run: go('/crm?new=1') },
      { id: 'a-reset', group: 'Actions', label: 'Reset demo data', run: () => { s.resetDemo(); setOpen(false); } },
    ];
    const t = q.trim().toLowerCase();
    if (!t) return all.filter((i) => i.group === 'Modules' || i.group === 'Actions');
    return all.filter((i) => (i.label + ' ' + (i.hint ?? '')).toLowerCase().includes(t)).slice(0, 40);
  }, [q, s, router, setOpen]);

  const groups = [...new Set(items.map((i) => i.group))];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    if (e.key === 'Enter') items[sel]?.run();
  };
  let idx = -1;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-start justify-center bg-bg/60 px-4 pt-[12vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
          <motion.div role="dialog" aria-label="Command palette" className="panel w-full max-w-xl overflow-hidden p-0" initial={{ y: -10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -10, scale: 0.98 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b hairline px-4">
              <Search size={16} className="text-ink-3" />
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} placeholder="Search everything or run an action…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" aria-label="Search" />
              <kbd className="rounded-md border hairline px-1.5 text-2xs text-ink-3">esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {!items.length && <div className="px-3 py-10 text-center text-sm text-ink-3">No results for “{q}”.</div>}
              {groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="eyebrow px-3 py-1.5">{g}</div>
                  {items.filter((i) => i.group === g).map((i) => {
                    idx++;
                    const me = idx;
                    return (
                      <button key={i.group + i.id} onMouseEnter={() => setSel(me)} onClick={i.run}
                        className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left', sel === me ? 'bg-blue/15' : '')}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{i.label}</span>
                          {i.hint && <span className="block truncate text-2xs text-ink-3">{i.hint}</span>}
                        </span>
                        {sel === me && <CornerDownLeft size={13} className="text-ink-3" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

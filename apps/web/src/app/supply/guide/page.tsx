'use client';
/**
 * SUPPLY360 guide: every screen in one place, grouped as in the sidebar, with what it is for and
 * where it fits. The same text as the "i" buttons (lib/supply/help.ts), so there is one copy to edit.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Panel, SearchInput } from '@/components/ui/primitives';
import { SupplyHeader } from '@/components/supply/kit';
import { InfoTip } from '@/components/supply/info-tip';
import { screenHelp } from '@/lib/supply/help';
import { groups, screens } from '@/lib/supply/screens';

export default function Guide() {
  const [q, setQ] = useState('');
  const shown = useMemo(() => screens.filter((s) => {
    const h = screenHelp(s.slug);
    return !q || `${s.label} ${s.group} ${h?.what ?? ''} ${h?.where ?? ''} ${(h?.how ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase());
  }), [q]);
  return (
    <div className="space-y-4">
      <SupplyHeader source="live" title="How SUPPLY360 fits together"
        subtitle="Every screen, what it is for and when to use it. Look for the i button next to any screen or panel title for the same help in place."
        actions={<SearchInput value={q} onChange={setQ} placeholder="Search the guide…" className="w-64" />} />
      {groups.map((g) => {
        const items = shown.filter((s) => s.group === g.id && !s.hidden);
        if (!items.length) return null;
        return (
          <Panel key={g.id} className="p-4" aria-labelledby={`g-${g.id}`}>
            <h2 id={`g-${g.id}`} className="mb-2 font-display text-[15px] font-semibold">{g.id}</h2>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((s) => {
                const h = screenHelp(s.slug);
                return (
                  <li key={s.slug} className="rounded-xl border hairline p-3">
                    <div className="flex items-center gap-1"><Link href={`/supply/${s.slug}`} className="text-[13px] font-semibold text-primary hover:underline">{s.label}</Link><InfoTip entry={h} label={s.label} /></div>
                    <p className="mt-1 text-[12.5px] text-ink-2">{h?.what ?? s.summary}</p>
                    {h?.where && <p className="mt-1 text-2xs text-ink-3">{h.where}</p>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
      {shown.length === 0 && <Panel className="py-12 text-center text-[13px] text-ink-3">Nothing in the guide matches “{q}”.</Panel>}
    </div>
  );
}

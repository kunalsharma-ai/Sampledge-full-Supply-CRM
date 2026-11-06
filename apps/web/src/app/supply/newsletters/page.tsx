'use client';
/**
 * Screen 28 · Newsletter Studio. Issue board by stage (draft → review → scheduled → sent), the
 * selected issue's story list with stage actions, and the content library to pull stories from.
 * Each panel has its own template (colour and masthead), shown on the issue cards.
 * Integration: issues `GET/PUT /communications/newsletters` (planned).
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BookOpen, GripVertical, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel, Segmented } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { StatusDot, StatusPill, type Status } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { contentLibrary, issues as seed, type Issue, type IssueStatus } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn } from '@/lib/utils';

const screen = screenBySlug('newsletters')!;
const stages: { id: IssueStatus; label: string; status: Status; next?: { to: IssueStatus; label: string } }[] = [
  { id: 'draft', label: 'Draft', status: 'draft', next: { to: 'review', label: 'Send for review' } },
  { id: 'review', label: 'In review', status: 'pending', next: { to: 'scheduled', label: 'Approve and schedule' } },
  { id: 'scheduled', label: 'Scheduled', status: 'scheduled' },
  { id: 'sent', label: 'Sent', status: 'completed' },
];
const brandOf = (p: PanelId) => panelBrands.find((b) => b.id === p)!;

export default function Newsletters() {
  const toast = useOS((s) => s.toast);
  const [list, setList] = useState(seed);
  const [panel, setPanel] = useState<'all' | PanelId>('all');
  const [selId, setSelId] = useState(seed.find((i) => i.status === 'review')!.id);
  const [confirm, setConfirm] = useState<Issue | null>(null);
  const rows = useMemo(() => list.filter((i) => panel === 'all' || i.panel === panel), [list, panel]);
  const sel = list.find((i) => i.id === selId)!;
  const editable = sel.status === 'draft' || sel.status === 'review';
  const patch = (id: string, p: Partial<Issue>) => setList((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const advance = (i: Issue) => {
    const st = stages.find((s) => s.id === i.status)!;
    if (!st.next) return;
    if (st.next.to === 'scheduled') { setConfirm(i); return; }
    patch(i.id, { status: st.next.to }); toast(`${i.title}: sent for review`, 'ok');
  };
  const sent = list.filter((i) => i.status === 'sent');
  const avgOpen = sent.reduce((a, i) => a + (i.openRate ?? 0), 0) / Math.max(1, sent.length);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Newsletter studio" subtitle="Plan, review and schedule each panel’s newsletter. Stories come from a shared library; every panel keeps its own template."
        actions={<Segmented label="Panel" size="sm" value={panel} onChange={setPanel} options={[{ value: 'all', label: 'All panels' }, ...panelBrands.map((b) => ({ value: b.id, label: b.short }))]} />}>
        <p className="mt-1 text-2xs text-ink-3">Last {sent.length} sent issues averaged <b className="num text-ink">{(avgOpen * 100).toFixed(1)}%</b> opens.</p>
      </SupplyHeader>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stages.map((st) => {
          const items = rows.filter((i) => i.status === st.id);
          return (
            <section key={st.id} aria-label={`${st.label}, ${items.length}`} className="rounded-2xl bg-surface-2/25 p-2">
              <header className="mb-2 flex items-center gap-2 px-1 text-[12.5px] font-semibold"><StatusDot status={st.status} label={st.label} /><span className="num text-2xs text-ink-3">{items.length}</span></header>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {items.map((i) => {
                    const b = brandOf(i.panel);
                    return (
                      <motion.button key={i.id} layout layoutId={i.id} onClick={() => setSelId(i.id)} aria-pressed={i.id === selId}
                        className={cn('block w-full overflow-hidden rounded-xl border bg-surface text-left shadow-panel', i.id === selId ? 'border-primary ring-1 ring-primary' : 'hairline')}>
                        <span className="block h-1.5" style={{ background: b.color }} aria-hidden />
                        <span className="block p-3">
                          <span className="flex items-center justify-between"><PanelChip panel={i.panel} short /><span className="text-2xs text-ink-3">{i.date}</span></span>
                          <span className="mt-1 block text-[13px] font-semibold leading-snug">{i.title}</span>
                          <span className="mt-1 block text-2xs text-ink-3">{i.stories.length} stories · {i.owner}{i.openRate !== undefined && ` · ${(i.openRate * 100).toFixed(0)}% opens`}</span>
                        </span>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
                {items.length === 0 && <p className="rounded-xl border border-dashed hairline py-5 text-center text-2xs text-ink-3">Nothing here</p>}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="p-4">
          <SectionTitle eyebrow={`${brandOf(sel.panel).name} · ${sel.owner}`} title={sel.title}
            actions={<><StatusPill status={stages.find((s) => s.id === sel.status)!.status} label={stages.find((s) => s.id === sel.status)!.label} />
              {stages.find((s) => s.id === sel.status)!.next && <Button size="sm" onClick={() => advance(sel)}>{stages.find((s) => s.id === sel.status)!.next!.label} <ArrowRight size={13} /></Button>}</>} />
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <ol className="space-y-1.5" aria-label="Stories in this issue">
              {sel.stories.map((s, k) => (
                <li key={`${s}-${k}`} className="flex items-center gap-2 rounded-lg bg-surface-2/40 px-3 py-2 text-[12.5px]">
                  <GripVertical size={13} className="text-ink-3" aria-hidden /><span className="num w-5 text-ink-3">{k + 1}</span><span className="flex-1">{s}</span>
                  {editable && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s}`} onClick={() => patch(sel.id, { stories: sel.stories.filter((_, j) => j !== k) })}><X size={12} /></Button>}
                </li>
              ))}
              {sel.stories.length === 0 && <li className="py-6 text-center text-2xs text-ink-3">No stories yet. Add some from the library.</li>}
            </ol>
            <div className="overflow-hidden rounded-xl border hairline bg-white text-[#1d2433]" aria-label="Template preview">
              <div className="px-3 py-2 text-[11px] font-bold text-white" style={{ background: `color-mix(in srgb, ${brandOf(sel.panel).color} 62%, black)` }}>{brandOf(sel.panel).name} · Newsletter</div>
              <div className="space-y-1.5 p-3">{sel.stories.slice(0, 4).map((s, k) => <div key={k} className={cn('rounded bg-[#eef0f5]', k === 0 ? 'h-12' : 'h-5')} title={s} />)}</div>
            </div>
          </div>
          {sel.status === 'sent' && <p className="mt-3 text-2xs text-ink-3">Sent {sel.date} · {((sel.openRate ?? 0) * 100).toFixed(1)}% opened · {((sel.clickRate ?? 0) * 100).toFixed(1)}% clicked</p>}
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Content library" title={`${contentLibrary.length} stories`} actions={<BookOpen size={14} className="text-ink-3" />} />
          <ul className="space-y-1.5">
            {contentLibrary.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/40">
                <Badge tone={c.kind === 'Rewards' ? 'emerald' : c.kind === 'Research' ? 'blue' : c.kind === 'Safety' ? 'warn' : 'purple'}>{c.kind}</Badge>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.title}</span>
                <Button size="icon-sm" variant="ghost" disabled={!editable || sel.stories.includes(c.title)} aria-label={`Add ${c.title} to ${sel.title}`}
                  onClick={() => { patch(sel.id, { stories: [...sel.stories, c.title] }); toast('Story added', 'ok'); }}><Plus size={13} /></Button>
              </li>
            ))}
          </ul>
          {!editable && <p className="mt-2 text-2xs text-ink-3">Scheduled and sent issues are locked.</p>}
        </Panel>
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title={`Approve and schedule “${confirm?.title ?? ''}”?`}
        body={confirm ? `It goes to every ${brandOf(confirm.panel).name} member with newsletter consent on the next send day. After scheduling the issue is locked.` : ''}
        confirmLabel="Approve and schedule" onConfirm={() => { if (confirm) { patch(confirm.id, { status: 'scheduled', date: 'Nov 14' }); toast(`${confirm.title} scheduled`, 'ok'); } setConfirm(null); }} />
    </div>
  );
}

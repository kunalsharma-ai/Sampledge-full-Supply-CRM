'use client';
/**
 * Screen 28 · Newsletter Studio. Issue board by stage (draft → review → scheduled → sent), the
 * selected issue's story list with stage actions, and the content library to pull stories from.
 * Each panel has its own template (colour and masthead), shown on the issue cards.
 * Live: issues are `newsletter` records (`/supply/records/newsletter`). Stories and titles save as
 * you edit; "Approve and schedule" sets a send time that the scheduler keeps, and "Send now" queues
 * one Comms Hub message to the panel's consented members (held for the high-volume approval above
 * the threshold). Opens and clicks need tracking from the delivery provider and are not shown live.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BookOpen, GripVertical, Plus, Send, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Field, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { StatusDot, StatusPill, type Status } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { ApiError } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { apiBrand, brandFromApi, loadMessages, messageLabel, records, type LiveMessage, type NewsletterData, type Rec } from '@/lib/supply/live';
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
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
type LiveIssue = Issue & { rec: Rec<NewsletterData>; failed?: string; message?: LiveMessage };
const toIssue = (r: Rec<NewsletterData>, msgs: LiveMessage[]): LiveIssue => ({
  id: r.id, rec: r, panel: brandFromApi[r.data.brand] ?? 't2o', title: r.data.title, stories: r.data.stories ?? [], owner: r.createdBy.replace(/ \(Demo\)$/, ''),
  status: r.status === 'failed' ? 'review' : (r.status as IssueStatus), failed: r.status === 'failed' ? r.data.error ?? 'The scheduled send failed' : undefined,
  date: r.status === 'sent' ? shortDate(r.data.sentAt) : r.status === 'scheduled' ? shortDate(r.data.sendAt) : '—',
  message: r.data.messageId ? msgs.find((m) => m.id === r.data.messageId) : undefined,
});

export default function Newsletters() {
  const toast = useOS((s) => s.toast);
  const q = useSupplyData<{ recs: Rec<NewsletterData>[]; messages: LiveMessage[] } | null>('newsletters', () => null, async () => {
    const [recs, messages] = await Promise.all([records.list<NewsletterData>('newsletter'), loadMessages().catch(() => [] as LiveMessage[])]);
    return { recs, messages };
  });
  const liveData = q.source === 'live' && q.data ? q.data : null;
  const liveIssues = useMemo(() => liveData?.recs.filter((r) => r.status !== 'cancelled').map((r) => toIssue(r, liveData.messages)) ?? null, [liveData]);
  const [demoList, setList] = useState(seed);
  const list: Issue[] = liveIssues ?? demoList;
  const [panel, setPanel] = useState<'all' | PanelId>('all');
  const [selId, setSelId] = useState(seed.find((i) => i.status === 'review')!.id);
  const [confirm, setConfirm] = useState<Issue | null>(null);
  const [sendNow, setSendNow] = useState<LiveIssue | null>(null);
  const [sendAt, setSendAt] = useState(() => localInput(new Date(Date.now() + 3 * 24 * 3600_000)));
  const [titleDraft, setTitleDraft] = useState('');
  const rows = useMemo(() => list.filter((i) => panel === 'all' || i.panel === panel), [list, panel]);
  const sel = (list.find((i) => i.id === selId) ?? list[0]) as LiveIssue | Issue | undefined;
  const lsel = liveIssues && sel ? (sel as LiveIssue) : null;
  useEffect(() => { setTitleDraft(sel?.title ?? ''); }, [sel?.id, sel?.title]);
  const editable = !!sel && (sel.status === 'draft' || sel.status === 'review');
  const fail = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : `Could not ${what}`, 'warn');
  const patch = async (id: string, p: Partial<Issue>) => {
    if (!liveIssues) { setList((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i))); return true; }
    const it = liveIssues.find((i) => i.id === id);
    if (!it) return false;
    try { await records.update<NewsletterData>('newsletter', it.rec, { ...(p.stories ? { stories: p.stories } : {}), ...(p.title ? { title: p.title } : {}) }); q.reload(); return true; } catch (e) { fail(e, 'save the issue'); return false; }
  };
  const act = async (i: LiveIssue, action: string, extra: Record<string, unknown> = {}, done?: string) => {
    try { const r = await records.act<NewsletterData>('newsletter', i.rec, action, extra); q.reload(); if (done) toast(done.replace('{ref}', r.ref), 'ok'); return r; } catch (e) { fail(e, 'change the issue'); return null; }
  };
  const advance = (i: Issue) => {
    const st = stages.find((s) => s.id === i.status)!;
    if (!st.next) return;
    if (st.next.to === 'scheduled') { setConfirm(i); return; }
    if (liveIssues) { void act(i as LiveIssue, 'submit', {}, `${i.title}: sent for review`); return; }
    void patch(i.id, { status: st.next.to }); toast(`${i.title}: sent for review`, 'ok');
  };
  const create = async () => {
    const p: PanelId = panel === 'all' ? 't2o' : panel;
    const month = new Date(Date.now() + 20 * 24 * 3600_000).toLocaleDateString(undefined, { month: 'long' });
    try { const r = await records.create<NewsletterData>('newsletter', { title: `${month} at ${brandOf(p).name}`, brand: apiBrand[p] }); q.reload(); setSelId(r.id); toast(`${r.ref} started as a draft`, 'ok'); } catch (e) { fail(e, 'start an issue'); }
  };
  const sent = list.filter((i) => i.status === 'sent');
  const avgOpen = sent.reduce((a, i) => a + (i.openRate ?? 0), 0) / Math.max(1, sent.length);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={liveIssues ? 'live' : 'demo'} title="Newsletter studio" subtitle="Plan, review and schedule each panel’s newsletter. Stories come from a shared library; every panel keeps its own template."
        actions={<>
          <Segmented label="Panel" size="sm" value={panel} onChange={setPanel} options={[{ value: 'all', label: 'All panels' }, ...panelBrands.map((b) => ({ value: b.id, label: b.short }))]} />
          {liveIssues && <Button size="sm" onClick={create}><Plus size={13} /> New issue</Button>}
        </>}>
        {liveIssues
          ? <p className="mt-1 text-2xs text-ink-3"><b className="num text-ink">{sent.length}</b> sent from SUPPLY360. Opens and clicks appear once the delivery provider reports them.</p>
          : <p className="mt-1 text-2xs text-ink-3">Last {sent.length} sent issues averaged <b className="num text-ink">{(avgOpen * 100).toFixed(1)}%</b> opens.</p>}
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
                          {(i as LiveIssue).failed && <span className="mt-1 block text-2xs font-semibold text-warn">Send failed</span>}
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

      {!sel ? <Panel className="p-6 text-center text-[12.5px] text-ink-3">No issues yet. Start one with “New issue”.</Panel> : (
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="p-4">
          <SectionTitle help="Selected issue" eyebrow={`${brandOf(sel.panel).name} · ${sel.owner}`} title={sel.title}
            actions={<><StatusPill status={stages.find((s) => s.id === sel.status)!.status} label={stages.find((s) => s.id === sel.status)!.label} />
              {lsel && sel.status === 'review' && <Button size="sm" variant="ghost" onClick={() => act(lsel, 'return', {}, `${sel.title} is a draft again`)}><Undo2 size={13} /> Back to draft</Button>}
              {lsel && sel.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => act(lsel, 'unschedule', {}, `${sel.title} is back in review`)}><Undo2 size={13} /> Unschedule</Button>}
              {lsel && (sel.status === 'scheduled' || sel.status === 'review') && sel.stories.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSendNow(lsel)}><Send size={13} /> Send now</Button>}
              {stages.find((s) => s.id === sel.status)!.next && <Button size="sm" onClick={() => advance(sel)}>{stages.find((s) => s.id === sel.status)!.next!.label} <ArrowRight size={13} /></Button>}</>} />
          {lsel?.failed && <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">The scheduled send failed: {lsel.failed}. Fix it, then schedule or send again.</p>}
          {lsel && editable && <Field label="Issue title"><input className={inputCls} value={titleDraft} maxLength={120} onChange={(e) => setTitleDraft(e.target.value)} onBlur={() => { if (titleDraft.trim().length >= 2 && titleDraft !== sel.title) void patch(sel.id, { title: titleDraft.trim() }).then((ok) => ok && toast('Title saved', 'ok')); }} /></Field>}
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
          {sel.status === 'sent' && (lsel
            ? <p className="mt-3 text-2xs text-ink-3">Sent {sel.date} to {(lsel.rec.data.recipients ?? 0).toLocaleString()} members · {lsel.message ? messageLabel[lsel.message.status] ?? lsel.message.status : lsel.rec.data.needsApproval ? 'Awaiting approval' : 'Queued'}</p>
            : <p className="mt-3 text-2xs text-ink-3">Sent {sel.date} · {((sel.openRate ?? 0) * 100).toFixed(1)}% opened · {((sel.clickRate ?? 0) * 100).toFixed(1)}% clicked</p>)}
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Content library" title={`${contentLibrary.length} stories`} actions={<BookOpen size={14} className="text-ink-3" />} />
          <ul className="space-y-1.5">
            {contentLibrary.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/40">
                <Badge tone={c.kind === 'Rewards' ? 'emerald' : c.kind === 'Research' ? 'blue' : c.kind === 'Safety' ? 'warn' : 'purple'}>{c.kind}</Badge>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{c.title}</span>
                <Button size="icon-sm" variant="ghost" disabled={!editable || sel.stories.includes(c.title)} aria-label={`Add ${c.title} to ${sel.title}`}
                  onClick={() => { void patch(sel.id, { stories: [...sel.stories, c.title] }).then((ok) => ok && toast('Story added', 'ok')); }}><Plus size={13} /></Button>
              </li>
            ))}
          </ul>
          {!editable && <p className="mt-2 text-2xs text-ink-3">Scheduled and sent issues are locked.</p>}
        </Panel>
      </div>
      )}

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title={`Approve and schedule “${confirm?.title ?? ''}”?`}
        body={confirm ? (liveIssues
          ? <div className="space-y-2"><p>It goes to every {brandOf(confirm.panel).name} member who has not withdrawn e-mail consent. After scheduling the issue is locked until you unschedule it.</p>
            <Field label="Send at (your time)"><input type="datetime-local" className={inputCls} value={sendAt} onChange={(e) => setSendAt(e.target.value)} /></Field></div>
          : `It goes to every ${brandOf(confirm.panel).name} member with newsletter consent on the next send day. After scheduling the issue is locked.`) : ''}
        confirmLabel="Approve and schedule" onConfirm={() => {
          if (confirm && liveIssues) void act(confirm as LiveIssue, 'schedule', { sendAt: new Date(sendAt).toISOString() }, `${confirm.title} scheduled for ${new Date(sendAt).toLocaleString()}`);
          else if (confirm) { void patch(confirm.id, { status: 'scheduled', date: 'Nov 14' }); toast(`${confirm.title} scheduled`, 'ok'); }
          setConfirm(null);
        }} />
      <ConfirmDialog open={!!sendNow} onOpenChange={(o) => !o && setSendNow(null)} tone="primary" title={`Send “${sendNow?.title ?? ''}” now?`}
        body={sendNow ? `It goes to every ${brandOf(sendNow.panel).name} member who has not withdrawn e-mail consent, held for a high-volume approval when the audience is large. Once sent, it cannot be recalled.` : ''}
        confirmLabel="Send now" onConfirm={() => { if (sendNow) void act(sendNow, 'send', {}, '{ref} sent to the Comms Hub'); setSendNow(null); }} />
    </div>
  );
}

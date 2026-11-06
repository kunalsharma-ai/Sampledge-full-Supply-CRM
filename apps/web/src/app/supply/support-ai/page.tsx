'use client';
/**
 * Screen 34 · AI Support Assistant. A review lane of drafted replies: each shows the member's
 * question, the draft (editable), the confidence, the knowledge sources it used and any action it
 * proposes. Accept sends it, Edit opens it for changes, Reject sends the ticket back to a person.
 * The right column tracks deflection and lets the team set an auto-send threshold, which needs
 * confirmation because replies then go out without review.
 * Live: the lane holds a draft for each ticket waiting on the team (new or open), from
 * `POST /supply/ai/tickets/:id/draft` through the AI gateway (a connected Claude model, or the rules).
 * Accepting sends it as the ticket's reply through the Comms Hub, and grants the goodwill points it
 * proposes when there are any; rejecting leaves the ticket for a person in Support. Auto-send stays
 * off live: every AI reply is read by a person first.
 */
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Check, FileText, History, Pencil, ScrollText, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useSupplyData } from '@/lib/supply/data';
import { AI_SETUP, aiLabel, draftTicketReply, loadAiStatus, loadSupportAiStats, records, type AiStatus, type Rec, type TicketData } from '@/lib/supply/live';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Switch } from '@/components/ui/overlay';
import { KpiTile, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { deflection, suggestions as seed, type Suggestion } from '@/lib/supply/operations';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('support-ai')!;
const srcIcon = { 'Help article': BookOpen, Policy: ScrollText, Ledger: FileText, 'Past ticket': History } as const;

type Item = Suggestion & { rec?: Rec<TicketData>; goodwill?: number | null };
const conf = { high: 0.9, medium: 0.7, low: 0.45 } as const;
type LiveLane = { items: Item[]; stats: Awaited<ReturnType<typeof loadSupportAiStats>>; ai: AiStatus };

export default function SupportAI() {
  const toast = useOS((s) => s.toast);
  const q = useSupplyData<LiveLane | null>('support-ai:lane', () => null, async () => {
    const [recs, ai] = await Promise.all([records.list<TicketData>('ticket'), loadAiStatus()]);
    const waiting = recs.filter((r) => r.status === 'new' || r.status === 'open').slice(0, 8);
    const drafts = await Promise.all(waiting.map((r) => draftTicketReply(r.id).then((d) => ({ r, d })).catch(() => null)));
    const items: Item[] = drafts.filter((x): x is NonNullable<typeof x> => !!x).map(({ r, d }) => ({
      id: r.id, ticketId: r.ref, question: r.data.subject, draft: d.reply, confidence: conf[d.confidence], rec: r, goodwill: d.goodwill,
      sources: d.sources.map((t) => ({ title: t.replace(/^Ledger: /, ''), kind: t.startsWith('Ledger') ? 'Ledger' as const : 'Policy' as const })),
      action: d.goodwill ? `Grant ${d.goodwill} goodwill points` : d.escalate ? 'A person should check this first' : undefined,
    }));
    return { items, stats: await loadSupportAiStats(), ai };
  });
  const live = q.source === 'live' && q.data ? q.data : null;
  const [items, setItems] = useState<Item[]>(seed);
  useEffect(() => { if (live) setItems(live.items); }, [live]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; verdict: 'accepted' | 'edited' | 'rejected' }[]>([]);
  const [auto, setAuto] = useState(false);
  const [threshold, setThreshold] = useState(90);
  const [confirmAuto, setConfirmAuto] = useState(false);

  const resolve = async (s: Item, verdict: 'accepted' | 'edited' | 'rejected') => {
    if (live && s.rec && verdict !== 'rejected') {
      setBusy(true);
      try {
        const r = await records.act<TicketData>('ticket', s.rec, 'reply', { text: s.draft.trim() });
        if (s.goodwill) await records.act<TicketData>('ticket', r, 'goodwill', { points: s.goodwill });
      } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not send the reply', 'warn'); setBusy(false); return; }
      setBusy(false);
    }
    setItems((l) => l.filter((x) => x.id !== s.id));
    setDone((d) => [{ id: s.id, verdict }, ...d]);
    setEditing(null);
    toast(verdict === 'rejected' ? `${s.ticketId} left for a person in Support` : `Reply sent on ${s.ticketId}${s.goodwill || (!live && s.action) ? ` · ${s.action}` : ''}`, verdict === 'rejected' ? 'info' : 'ok');
  };
  const doneLabel = (id: string) => (live ? live.items : seed).find((s) => s.id === id)?.ticketId ?? id;
  const wouldAuto = seed.filter((s) => s.confidence * 100 >= threshold).length;

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={q.source} title="AI support assistant" subtitle="Drafted replies wait here for a person. Check the sources, edit if needed, then send." />
      {live && (
        <Panel className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-2xs text-ink-2">
          <Badge tone={live.ai.connected ? 'emerald' : 'neutral'}>{aiLabel(live.ai)}</Badge>
          <span>{live.ai.connected ? 'The model sees the ticket, the member’s handle and recent ledger lines; nothing is sent until you accept.' : AI_SETUP}</span>
        </Panel>
      )}

      {live ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label="Waiting on the team" value={live.stats.awaitingReply} format="int" hint="Tickets that are new or open" />
          <KpiTile label="Drafts made, 7 days" value={live.stats.drafts7d} format="int" hint="Support drafts from the AI gateway in the last 7 days" />
          <KpiTile label="Replies sent, 7 days" value={live.stats.replies7d} format="int" hint="Replies sent from Support or this lane in the last 7 days" />
        </div>
      ) : <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Deflection, last 7 days" value={deflection.last7[6]} format="pct" delta={deflection.last7[6] - deflection.last7[0]} spark={deflection.last7.map((x) => x * 100)} hint="Share of new tickets answered by an accepted AI draft without further replies" />
        <KpiTile label="Drafts reviewed" value={deflection.reviewed} format="int" hint="AI drafts a person accepted, edited or rejected in the last 30 days" />
        <KpiTile label="Sent without edits" value={deflection.acceptedAsIs} format="pct" hint="Of reviewed drafts, the share sent exactly as drafted" />
      </div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <SectionTitle eyebrow="Review lane" title={`${items.length} draft${items.length === 1 ? '' : 's'} waiting`} />
          <AnimatePresence initial={false}>
            {items.map((s) => {
              const isEdit = editing === s.id;
              const low = s.confidence < 0.6;
              return (
                <motion.article key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60, height: 0, marginTop: 0 }} transition={{ duration: 0.22 }}
                  className="panel p-4">
                  <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
                    <span className="font-mono">{s.ticketId}</span><span>·</span><span className="text-ink-2">“{s.question}”</span>
                    <span className="ml-auto flex items-center gap-1.5"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-3/15"><span className={cn('block h-full rounded-full', low ? 'bg-warn' : 'bg-emerald')} style={{ width: `${s.confidence * 100}%` }} /></span><span className={cn('num font-semibold', low ? 'text-warn' : 'text-ink-2')}>{Math.round(s.confidence * 100)}%</span></span>
                  </div>
                  <div className="mt-2 flex gap-2.5">
                    <Sparkles size={15} className="mt-0.5 shrink-0 text-purple" aria-hidden />
                    {isEdit
                      ? <textarea aria-label={`Edit draft for ${s.ticketId}`} autoFocus rows={4} className={cn(inputCls, 'h-auto py-2')} value={s.draft} onChange={(e) => setItems((l) => l.map((x) => (x.id === s.id ? { ...x, draft: e.target.value } : x)))} />
                      : <p className="text-[13px] leading-relaxed">{s.draft}</p>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-2xs text-ink-3">Sources:</span>
                    {s.sources.map((src) => { const I = srcIcon[src.kind]; return <span key={src.title} className="inline-flex items-center gap-1 rounded-md bg-surface-2/60 px-1.5 py-0.5 text-2xs text-ink-2 ring-1 ring-inset ring-ink-3/15" title={src.kind}><I size={11} aria-hidden />{src.title}</span>; })}
                    {s.action && <Badge tone="purple">Proposes: {s.action}</Badge>}
                  </div>
                  {low && <p className="mt-2 text-2xs text-warn">Low confidence: check the facts before sending.</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {isEdit
                      ? <Button size="sm" disabled={busy || !s.draft.trim()} onClick={() => void resolve(s, 'edited')}><Check size={13} /> Send edited</Button>
                      : <Button size="sm" variant="success" disabled={busy} onClick={() => void resolve(s, 'accepted')}><Check size={13} /> {live && s.goodwill ? `Send and grant ${s.goodwill} points` : 'Accept and send'}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(isEdit ? null : s.id)}><Pencil size={13} /> {isEdit ? 'Stop editing' : 'Edit'}</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(s, 'rejected')}><X size={13} /> Reject</Button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
          {items.length === 0 && <Panel className="py-12 text-center text-[13px] text-ink-3">{q.loading ? 'Drafting replies…' : 'All drafts reviewed. New ones arrive as tickets come in.'}</Panel>}
        </div>

        <div className="space-y-4">
          {!live && <Panel className="p-4">
            <SectionTitle eyebrow="Last 30 days" title="What reviewers did" />
            <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Accepted ${Math.round(deflection.acceptedAsIs * 100)}%, edited ${Math.round(deflection.edited * 100)}%, rejected ${Math.round(deflection.rejected * 100)}%`}>
              <span className="bg-emerald" style={{ width: `${deflection.acceptedAsIs * 100}%` }} /><span className="bg-warn" style={{ width: `${deflection.edited * 100}%` }} /><span className="bg-danger" style={{ width: `${deflection.rejected * 100}%` }} />
            </div>
            <ul className="mt-2 flex justify-between text-2xs text-ink-3"><li>Accepted {Math.round(deflection.acceptedAsIs * 100)}%</li><li>Edited {Math.round(deflection.edited * 100)}%</li><li>Rejected {Math.round(deflection.rejected * 100)}%</li></ul>
            <EChart ariaLabel="Deflection rate over the last 7 days" height={130} option={(t) => ({
              grid: { left: 4, right: 4, top: 12, bottom: 2, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (v) => `${(Number(v) * 100).toFixed(0)}%` },
              xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ...axis(t) }, yAxis: { type: 'value', min: 0.2, ...axis(t, { axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%`, color: 'rgb(var(--ink-3))', fontSize: 10 } }) },
              series: [{ type: 'line', name: 'Deflection', data: deflection.last7, smooth: true, symbolSize: 5, itemStyle: { color: 'rgb(var(--chart-3))' }, areaStyle: { opacity: 0.15 } }],
            })} />
          </Panel>}
          <Panel className="p-4">
            <SectionTitle eyebrow="Automation" title="Auto-send" actions={!live && <Switch checked={auto} label="Auto-send high-confidence replies" onCheckedChange={(v) => (v ? setConfirmAuto(true) : (setAuto(false), toast('Auto-send off', 'info')))} />} />
            {live ? <p className="text-2xs text-ink-3">Off in this workspace: every AI reply is read by a person before it reaches a member.</p> : <>
            <label className="block text-2xs text-ink-3">Send without review at <b className="num text-ink">{threshold}%</b> confidence or higher
              <input type="range" min={70} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--primary))]" /></label>
            <p className="mt-1 text-2xs text-ink-3">{wouldAuto} of today’s {seed.length} drafts would have gone out automatically. Drafts with a proposed action always need a person.</p></>}
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="This session" title={`${done.length} reviewed`} />
            <ul className="space-y-1 text-[12.5px]">{done.map((d) => <li key={d.id} className="flex justify-between"><span className="font-mono text-2xs">{doneLabel(d.id)}</span><span className={cn('text-2xs font-semibold capitalize', d.verdict === 'rejected' ? 'text-danger' : d.verdict === 'edited' ? 'text-warn' : 'text-emerald')}>{d.verdict}</span></li>)}
              {done.length === 0 && <li className="text-2xs text-ink-3">Nothing yet.</li>}</ul>
            {!live && <p className="mt-2 text-2xs text-ink-3">Auto-resolved this month: <b className="num text-ink">{fmtNum(deflection.autoResolved)}</b></p>}
          </Panel>
        </div>
      </div>

      <ConfirmDialog open={confirmAuto} onOpenChange={setConfirmAuto} tone="primary" title="Turn on auto-send?"
        body={`Replies with ${threshold}% confidence or higher will go to members without anyone reading them first. Drafts that propose an action (points, account changes) still wait for review.`}
        confirmLabel="Turn on" onConfirm={() => { setAuto(true); setConfirmAuto(false); toast(`Auto-send on at ${threshold}%`, 'ok'); }} />
    </div>
  );
}

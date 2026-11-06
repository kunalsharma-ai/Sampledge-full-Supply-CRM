'use client';
/**
 * Screen 34 · AI Support Assistant. A review lane of drafted replies: each shows the member's
 * question, the draft (editable), the confidence, the knowledge sources it used and any action it
 * proposes. Accept sends it, Edit opens it for changes, Reject sends the ticket back to a person.
 * The right column tracks deflection and lets the team set an auto-send threshold, which needs
 * confirmation because replies then go out without review.
 * Integration: drafts from the AI gateway (`/ai/*`), sends via `POST /support/tickets/:id/messages` (planned).
 */
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Check, FileText, History, Pencil, ScrollText, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
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

export default function SupportAI() {
  const toast = useOS((s) => s.toast);
  const [items, setItems] = useState(seed);
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; verdict: 'accepted' | 'edited' | 'rejected' }[]>([]);
  const [auto, setAuto] = useState(false);
  const [threshold, setThreshold] = useState(90);
  const [confirmAuto, setConfirmAuto] = useState(false);

  const resolve = (s: Suggestion, verdict: 'accepted' | 'edited' | 'rejected') => {
    setItems((l) => l.filter((x) => x.id !== s.id));
    setDone((d) => [{ id: s.id, verdict }, ...d]);
    setEditing(null);
    toast(verdict === 'rejected' ? `${s.ticketId} sent back to the queue` : `Reply sent on ${s.ticketId}${s.action ? ` · ${s.action}` : ''}`, verdict === 'rejected' ? 'info' : 'ok');
  };
  const wouldAuto = seed.filter((s) => s.confidence * 100 >= threshold).length;

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="AI support assistant" subtitle="Drafted replies wait here for a person. Check the sources, edit if needed, then send." />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Deflection, last 7 days" value={deflection.last7[6]} format="pct" delta={deflection.last7[6] - deflection.last7[0]} spark={deflection.last7.map((x) => x * 100)} hint="Share of new tickets answered by an accepted AI draft without further replies" />
        <KpiTile label="Drafts reviewed" value={deflection.reviewed} format="int" hint="AI drafts a person accepted, edited or rejected in the last 30 days" />
        <KpiTile label="Sent without edits" value={deflection.acceptedAsIs} format="pct" hint="Of reviewed drafts, the share sent exactly as drafted" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <SectionTitle eyebrow="Review lane" title={`${items.length} drafts waiting`} />
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
                      ? <Button size="sm" onClick={() => resolve(s, 'edited')}><Check size={13} /> Send edited</Button>
                      : <Button size="sm" variant="success" onClick={() => resolve(s, 'accepted')}><Check size={13} /> Accept and send</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(isEdit ? null : s.id)}><Pencil size={13} /> {isEdit ? 'Stop editing' : 'Edit'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve(s, 'rejected')}><X size={13} /> Reject</Button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
          {items.length === 0 && <Panel className="py-12 text-center text-[13px] text-ink-3">All drafts reviewed. New ones arrive as tickets come in.</Panel>}
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
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
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="Automation" title="Auto-send" actions={<Switch checked={auto} label="Auto-send high-confidence replies" onCheckedChange={(v) => (v ? setConfirmAuto(true) : (setAuto(false), toast('Auto-send off', 'info')))} />} />
            <label className="block text-2xs text-ink-3">Send without review at <b className="num text-ink">{threshold}%</b> confidence or higher
              <input type="range" min={70} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--primary))]" /></label>
            <p className="mt-1 text-2xs text-ink-3">{wouldAuto} of today’s {seed.length} drafts would have gone out automatically. Drafts with a proposed action always need a person.</p>
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="This session" title={`${done.length} reviewed`} />
            <ul className="space-y-1 text-[12.5px]">{done.map((d) => <li key={d.id} className="flex justify-between"><span className="font-mono text-2xs">{seed.find((s) => s.id === d.id)!.ticketId}</span><span className={cn('text-2xs font-semibold capitalize', d.verdict === 'rejected' ? 'text-danger' : d.verdict === 'edited' ? 'text-warn' : 'text-emerald')}>{d.verdict}</span></li>)}
              {done.length === 0 && <li className="text-2xs text-ink-3">Nothing yet.</li>}</ul>
            <p className="mt-2 text-2xs text-ink-3">Auto-resolved this month: <b className="num text-ink">{fmtNum(deflection.autoResolved)}</b></p>
          </Panel>
        </div>
      </div>

      <ConfirmDialog open={confirmAuto} onOpenChange={setConfirmAuto} tone="primary" title="Turn on auto-send?"
        body={`Replies with ${threshold}% confidence or higher will go to members without anyone reading them first. Drafts that propose an action (points, account changes) still wait for review.`}
        confirmLabel="Turn on" onConfirm={() => { setAuto(true); setConfirmAuto(false); toast(`Auto-send on at ${threshold}%`, 'ok'); }} />
    </div>
  );
}

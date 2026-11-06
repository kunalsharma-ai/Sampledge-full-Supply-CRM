'use client';
/**
 * Screen 32 · Redemption Approval Center. Queue grouped by risk band; select rows and approve in a
 * batch (with confirmation), or hold and reject one at a time with a reason. Every decision has a
 * 10-second undo window before it is committed. The side panel shows the member's context:
 * tenure, earning pattern, past redemptions and the risk signals behind the score.
 * Integration: decisions go to `POST /approvals/:id/decision` (available).
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, Check, ExternalLink, PauseCircle, ShieldAlert, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { PanelChip, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { redemptions as seed, type Redemption } from '@/lib/supply/operations';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('redemptions')!;
type Band = 'low' | 'review' | 'high';
const band = (r: number): Band => (r < 0.3 ? 'low' : r < 0.6 ? 'review' : 'high');
const bandMeta: Record<Band, { label: string; cls: string; tone: 'emerald' | 'warn' | 'danger' }> = {
  low: { label: 'Low risk', cls: 'bg-emerald', tone: 'emerald' }, review: { label: 'Needs review', cls: 'bg-warn', tone: 'warn' }, high: { label: 'High risk', cls: 'bg-danger', tone: 'danger' },
};
type Pending = { ids: string[]; verdict: 'approved' | 'held' | 'rejected'; until: number };
const UNDO_MS = 10_000;

export default function Redemptions() {
  const toast = useOS((s) => s.toast);
  const [queue, setQueue] = useState(seed);
  const [tab, setTab] = useState<Band | 'all'>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string>(seed[0].id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(Date.now());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ ids: string[]; verdict: 'held' | 'rejected' } | null>(null);
  const [reason, setReason] = useState('');
  const [log, setLog] = useState<{ id: string; verdict: string; usd: number }[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const hidden = new Set(pending?.ids ?? []);
  const visible = useMemo(() => queue.filter((r) => !hidden.has(r.id) && (tab === 'all' || band(r.risk) === tab)).sort((a, b) => b.risk - a.risk), [queue, tab, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = queue.find((r) => r.id === focus && !hidden.has(r.id)) ?? visible[0];
  const counts = { low: 0, review: 0, high: 0 } as Record<Band, number>;
  queue.filter((r) => !hidden.has(r.id)).forEach((r) => counts[band(r.risk)]++);
  const selRows = queue.filter((r) => sel.has(r.id) && !hidden.has(r.id));

  const commit = (p: Pending) => {
    const rows = queue.filter((r) => p.ids.includes(r.id));
    setQueue((q) => q.filter((r) => !p.ids.includes(r.id)));
    setLog((l) => [...rows.map((r) => ({ id: r.id, verdict: p.verdict, usd: r.usd })), ...l].slice(0, 12));
    setPending(null);
  };
  const decide = (ids: string[], verdict: Pending['verdict']) => {
    if (pending) commit(pending);
    setPending({ ids, verdict, until: Date.now() + UNDO_MS });
    setSel(new Set());
    toast(`${ids.length} redemption${ids.length > 1 ? 's' : ''} ${verdict}. Undo within 10 seconds.`, verdict === 'approved' ? 'ok' : 'warn');
  };
  useEffect(() => {
    if (!pending) return;
    timer.current = setInterval(() => { const t = Date.now(); setNow(t); if (t >= pending.until) commit(pending); }, 250);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allLow = visible.filter((r) => band(r.risk) === 'low').map((r) => r.id);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Redemption approvals" subtitle="Approve payouts in batches, look closer at the risky ones. Every decision can be undone for 10 seconds."
        actions={<Segmented label="Risk band" size="sm" value={tab} onChange={setTab} options={[{ value: 'all', label: `All ${queue.length - hidden.size}` }, { value: 'low', label: `Low ${counts.low}` }, { value: 'review', label: `Review ${counts.review}` }, { value: 'high', label: `High ${counts.high}` }]} />} />

      <AnimatePresence>
        {pending && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} role="status"
            className="relative flex items-center gap-3 overflow-hidden rounded-xl border hairline bg-surface px-4 py-2.5 shadow-panel">
            <span className="text-[13px]"><b>{pending.ids.length}</b> {pending.verdict}. Committing in <span className="num">{Math.max(0, Math.ceil((pending.until - now) / 1000))}s</span>.</span>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => { setPending(null); toast('Decision undone', 'info'); }}><Undo2 size={12} /> Undo</Button>
            <Button size="xs" variant="ghost" onClick={() => commit(pending)}>Commit now</Button>
            <span className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width] duration-200" style={{ width: `${Math.max(0, ((pending.until - now) / UNDO_MS) * 100)}%` }} aria-hidden />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b hairline p-3">
            <span className="text-[13px] font-semibold">{visible.length} waiting</span>
            {allLow.length > 0 && <Button size="xs" variant="ghost" onClick={() => setSel(new Set(allLow))}>Select all low risk ({allLow.length})</Button>}
            {selRows.length > 0 && (
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-2xs text-ink-3">{selRows.length} selected · {fmt.money(selRows.reduce((a, r) => a + r.usd, 0))}</span>
                <Button size="xs" variant="success" onClick={() => setConfirmBatch(true)}><Check size={12} /> Approve</Button>
                <Button size="xs" variant="ghost" onClick={() => setReasonFor({ ids: selRows.map((r) => r.id), verdict: 'held' })}><PauseCircle size={12} /> Hold</Button>
                <Button size="xs" variant="danger" onClick={() => setReasonFor({ ids: selRows.map((r) => r.id), verdict: 'rejected' })}><Ban size={12} /> Reject</Button>
              </span>
            )}
          </div>
          <ul aria-label="Redemptions waiting for a decision">
            <AnimatePresence initial={false}>
              {visible.map((r) => {
                const b = band(r.risk);
                return (
                  <motion.li key={r.id} layout exit={{ opacity: 0, height: 0 }} className={cn('flex items-center gap-3 border-b hairline px-3 py-2.5', cur?.id === r.id && 'bg-primary/[.06]')}>
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.id}`} className="h-4 w-4 accent-[rgb(var(--primary))]" />
                    <button onClick={() => setFocus(r.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="w-24 shrink-0"><span className="block h-1.5 overflow-hidden rounded-full bg-ink-3/15"><span className={cn('block h-full rounded-full', bandMeta[b].cls)} style={{ width: `${r.risk * 100}%` }} /></span><span className="num mt-0.5 block text-2xs text-ink-3">risk {Math.round(r.risk * 100)}</span></span>
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-[12.5px] font-medium"><PanelChip panel={r.panellist.brand} short /><span className="truncate">{r.panellist.handle}</span></span><span className="text-2xs text-ink-3">{r.method} · {r.requestedAgo}{r.signals.length > 0 && ` · ${r.signals.length} signal${r.signals.length > 1 ? 's' : ''}`}</span></span>
                      <span className="num w-16 text-right text-[14px] font-bold">{fmt.money(r.usd)}</span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
            {visible.length === 0 && <li className="py-12 text-center text-[13px] text-ink-3">Nothing waiting in this band.</li>}
          </ul>
        </Panel>

        <div className="space-y-4">
          {cur && (
            <Panel className="p-4">
              <SectionTitle help="Selected redemption" eyebrow={`${cur.id} · ${cur.method}`} title={<span className="flex items-center gap-2">{cur.panellist.handle}<Badge tone={bandMeta[band(cur.risk)].tone}>{bandMeta[band(cur.risk)].label}</Badge></span>} />
              <div className="num font-jakarta text-3xl font-bold">{fmt.money(cur.usd)}</div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-center text-[12.5px]">
                {[['Member for', `${fmtNum(cur.tenureDays)} days`], ['Past redemptions', cur.pastRedemptions], ['Earned, 30 days', `${fmtNum(cur.earnedLast30)} pts`], ['Quality score', Math.round(cur.panellist.qualityScore * 100)]].map(([k, v]) => (
                  <div key={String(k)} className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">{k}</dt><dd className="num font-semibold">{v}</dd></div>
                ))}
              </dl>
              <h3 className="eyebrow mb-1.5 mt-4">Signals</h3>
              {cur.signals.length ? <ul className="space-y-1">{cur.signals.map((s) => <li key={s} className="flex items-start gap-1.5 text-[12.5px] text-ink-2"><ShieldAlert size={13} className="mt-0.5 shrink-0 text-danger" />{s}</li>)}</ul> : <p className="text-[12.5px] text-ink-3">No risk signals. Score reflects tenure and earning pattern only.</p>}
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Button size="sm" variant="success" onClick={() => decide([cur.id], 'approved')}><Check size={13} /> Approve</Button>
                <Button size="sm" variant="ghost" onClick={() => setReasonFor({ ids: [cur.id], verdict: 'held' })}><PauseCircle size={13} /> Hold</Button>
                <Button size="sm" variant="danger" onClick={() => setReasonFor({ ids: [cur.id], verdict: 'rejected' })}><Ban size={13} /> Reject</Button>
              </div>
              <Link href={`/supply/panellists/${cur.panellist.id}`} className="mt-3 inline-flex items-center gap-1 text-2xs font-semibold text-primary hover:underline">Open 360° profile <ExternalLink size={11} /></Link>
            </Panel>
          )}
          <Panel className="p-4">
            <SectionTitle eyebrow="This session" title={`${log.length} decided`} />
            <ul className="space-y-1 text-[12.5px]">
              {log.map((l) => <li key={l.id} className="flex justify-between"><span className="font-mono text-2xs">{l.id}</span><span className={cn('text-2xs font-semibold capitalize', l.verdict === 'approved' ? 'text-emerald' : l.verdict === 'held' ? 'text-warn' : 'text-danger')}>{l.verdict}</span><span className="num">{fmt.money(l.usd)}</span></li>)}
              {log.length === 0 && <li className="text-2xs text-ink-3">Decisions appear here once committed.</li>}
            </ul>
          </Panel>
        </div>
      </div>

      <ConfirmDialog open={confirmBatch} onOpenChange={setConfirmBatch} tone="primary" title={`Approve ${selRows.length} redemptions?`}
        body={`${fmt.money(selRows.reduce((a, r) => a + r.usd, 0))} will be paid out through the providers. ${selRows.some((r) => band(r.risk) !== 'low') ? 'Some of these are not low risk. ' : ''}You can undo for 10 seconds.`}
        confirmLabel="Approve" onConfirm={() => { setConfirmBatch(false); decide(selRows.map((r) => r.id), 'approved'); }} />

      <Dialog open={!!reasonFor} onOpenChange={(o) => { if (!o) { setReasonFor(null); setReason(''); } }}>
        <DialogContent title={reasonFor?.verdict === 'held' ? 'Hold redemptions' : 'Reject redemptions'} description="The reason is saved with the decision and shown to support if the member asks.">
          <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-3">Reason
            <textarea autoFocus rows={3} className={cn(inputCls, 'mt-1 h-auto py-2 normal-case tracking-normal')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: device shared with flagged accounts; asked for ID." />
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setReasonFor(null); setReason(''); }}>Cancel</Button>
            <Button variant={reasonFor?.verdict === 'rejected' ? 'danger' : 'primary'} disabled={reason.trim().length < 5} onClick={() => { if (reasonFor) decide(reasonFor.ids, reasonFor.verdict); setReasonFor(null); setReason(''); }}>{reasonFor?.verdict === 'held' ? 'Hold' : 'Reject'} {reasonFor?.ids.length}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

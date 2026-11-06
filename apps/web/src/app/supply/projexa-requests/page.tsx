'use client';
/**
 * Screen 20 · PROJEXA Audience Requests. An inbox of audience requests raised by PROJEXA projects,
 * each read with its project context: client, project manager, milestones and budget. The supply
 * team accepts (passes it to SAMPLEON allocation, with an undo window), counter-proposes changed
 * terms (completes, IR, LOI, end date, CPI, with a reason and a diff), or declines with a reason.
 * Integration: PROJEXA sends requests to SAMPLEON (`POST /sampleon/v1/audience-requests`, built in the
 * integration work); counter-proposals go back as `PATCH /sampleon/v1/audience-requests/:id` (planned).
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, CheckCircle2, Circle, MessageSquareReply, TriangleAlert, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Bar, Button, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { CountryChips, ProductChip, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { projexaRequests, sampleonRequests, type ProjexaRequest } from '@/lib/supply/connected';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtMoney, fmtNum } from '@/lib/utils';

const screen = screenBySlug('projexa-requests')!;
type State = ProjexaRequest['state'];
type Ask = ProjexaRequest['ask'];
const stateTone: Record<State, 'blue' | 'emerald' | 'warn' | 'neutral'> = { new: 'blue', accepted: 'emerald', countered: 'warn', declined: 'neutral' };
const UNDO_S = 8;
const TODAY = '2026-11-06'; // demo clock

export default function ProjexaRequests() {
  const toast = useOS((s) => s.toast);
  const [items, setItems] = useState(projexaRequests);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [selId, setSelId] = useState(projexaRequests.find((p) => p.state === 'new')?.id ?? projexaRequests[0].id);
  const [dialog, setDialog] = useState<null | 'counter' | 'decline'>(null);
  const [undo, setUndo] = useState<{ id: string; left: number } | null>(null);
  const [counters, setCounters] = useState<Record<string, { ask: Ask; reason: string }>>({});

  useEffect(() => {
    if (!undo) return;
    if (undo.left <= 0) { setUndo(null); return; }
    const t = setTimeout(() => setUndo((u) => (u ? { ...u, left: u.left - 1 } : u)), 1000);
    return () => clearTimeout(t);
  }, [undo]);

  const shown = useMemo(() => items.filter((p) => filter === 'all' || p.state === 'new' || p.state === 'countered'), [items, filter]);
  const sel = items.find((p) => p.id === selId) ?? items[0];
  const setState = (id: string, state: State) => setItems((l) => l.map((p) => (p.id === id ? { ...p, state } : p)));

  const accept = (p: ProjexaRequest) => { setState(p.id, 'accepted'); setUndo({ id: p.id, left: UNDO_S }); toast(`${p.projectId} accepted; it is now in SAMPLEON allocation`, 'ok'); };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title={<span className="flex items-center gap-2.5"><ProductChip product="projexa" /> Audience requests</span>}
        subtitle="Requests raised by PROJEXA projects. Read each one with its project, then accept it into allocation, counter-propose terms, or decline." />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel className="flex max-h-[720px] flex-col p-0">
          <div className="flex items-center gap-2 border-b hairline p-3">
            <span className="text-[13px] font-semibold">Inbox</span>
            <Segmented label="Show" size="sm" className="ml-auto" value={filter} onChange={setFilter} options={[{ value: 'open', label: `Open (${items.filter((p) => p.state === 'new' || p.state === 'countered').length})` }, { value: 'all', label: 'All' }]} />
          </div>
          <ul className="flex-1 overflow-y-auto" aria-label="PROJEXA requests">
            {shown.map((p) => (
              <li key={p.id}>
                <button onClick={() => setSelId(p.id)} aria-current={p.id === sel.id ? 'true' : undefined}
                  className={cn('block w-full border-b hairline px-3 py-2.5 text-left hover:bg-surface-2/40', p.id === sel.id && 'bg-primary/[.07]')}>
                  <div className="flex items-center gap-2 text-2xs text-ink-3"><span className="font-mono">{p.projectId}</span><span>·</span><span>{p.received}</span><Badge tone={stateTone[p.state]} className="ml-auto capitalize">{p.state}</Badge></div>
                  <div className="mt-0.5 truncate text-[13px] font-medium">{p.project}</div>
                  <div className="mt-0.5 flex items-center justify-between text-2xs text-ink-3"><span className="truncate">{p.client} · {fmtNum(p.ask.completes)} completes</span>{p.risk && <TriangleAlert size={12} className="shrink-0 text-warn" aria-label="Has a risk" />}</div>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="p-8 text-center text-[13px] text-ink-3">Inbox clear. New requests arrive as PROJEXA projects reach questionnaire sign-off.</li>}
          </ul>
        </Panel>

        <Detail p={sel} counter={counters[sel.id]} undoLeft={undo?.id === sel.id ? undo.left : null}
          onUndo={() => { setState(sel.id, 'new'); setUndo(null); toast(`Acceptance of ${sel.projectId} undone`, 'info'); }}
          onAccept={() => accept(sel)} onCounter={() => setDialog('counter')} onDecline={() => setDialog('decline')} />
      </div>

      <CounterDialog open={dialog === 'counter'} onOpenChange={(v) => !v && setDialog(null)} p={sel}
        onSend={(ask, reason) => { setCounters((c) => ({ ...c, [sel.id]: { ask, reason } })); setState(sel.id, 'countered'); setDialog(null); toast(`Counter-proposal sent to ${sel.manager} in PROJEXA`, 'ok'); }} />
      <DeclineDialog open={dialog === 'decline'} onOpenChange={(v) => !v && setDialog(null)} p={sel}
        onDecline={() => { setState(sel.id, 'declined'); setDialog(null); toast(`${sel.projectId} declined; PROJEXA notified`, 'info'); }} />
    </div>
  );
}

function Detail({ p, counter, undoLeft, onUndo, onAccept, onCounter, onDecline }: { p: ProjexaRequest; counter?: { ask: Ask; reason: string }; undoLeft: number | null; onUndo: () => void; onAccept: () => void; onCounter: () => void; onDecline: () => void }) {
  const s = sampleonRequests.find((x) => x.id === p.requestId)!;
  const cost = p.ask.completes * p.ask.cpi;
  const overBudget = cost > p.budget.total;
  const open = p.state === 'new' || p.state === 'countered';
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3"><span className="font-mono">{p.projectId}</span><span>·</span><span>PM {p.manager}</span><span>·</span><span>received {p.received}</span><Badge tone={stateTone[p.state]} className="capitalize">{p.state}</Badge></div>
          <h2 className="mt-1 font-display text-lg font-semibold">{p.project}</h2>
          <p className="text-[12.5px] text-ink-2">{p.client}</p>
        </div>
        {open && <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="success" onClick={onAccept}><Check size={13} /> Accept</Button>
          <Button size="sm" variant="ghost" onClick={onCounter}><MessageSquareReply size={13} /> Counter-propose</Button>
          <Button size="sm" variant="ghost" onClick={onDecline}><X size={13} /> Decline</Button>
        </div>}
      </div>

      <AnimatePresence>
        {undoLeft != null && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 flex items-center gap-3 rounded-xl bg-emerald/10 px-3 py-2 text-[12.5px]" role="status">
            <CheckCircle2 size={14} className="text-emerald" /> Accepted and passed to SAMPLEON allocation.
            <Button size="xs" variant="ghost" className="ml-auto" onClick={onUndo}><Undo2 size={12} /> Undo ({undoLeft}s)</Button>
          </motion.div>
        )}
      </AnimatePresence>
      {p.risk && <p className="mt-3 flex items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[12.5px]"><TriangleAlert size={14} className="shrink-0 text-warn" />{p.risk}</p>}

      <section className="mt-4">
        <h3 className="eyebrow mb-2">Project milestones</h3>
        <ol className="flex items-start overflow-x-auto pb-1">
          {p.milestones.map((m, i) => (
            <li key={m.label} className="flex min-w-[120px] flex-1 flex-col">
              <div className="flex items-center">{m.done ? <CheckCircle2 size={15} className="shrink-0 text-emerald" aria-label="Done" /> : <Circle size={15} className="shrink-0 text-ink-3" aria-label="Not yet" />}{i < p.milestones.length - 1 && <span className={cn('mx-1 h-px flex-1', m.done ? 'bg-emerald/60' : 'bg-ink-3/25')} />}</div>
              <span className="mt-1 pr-2 text-[12px] font-medium">{m.label}</span><span className="num text-2xs text-ink-3">{m.date}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section>
          <SectionTitle eyebrow="What they ask for" title="Request terms" />
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">Request terms{counter ? ' and the counter-proposal' : ''}</caption>
            <thead className={counter ? '' : 'sr-only'}><tr className="text-left text-2xs text-ink-3"><th scope="col">Term</th><th scope="col" className="text-right">Asked</th>{counter && <th scope="col" className="text-right">We proposed</th>}</tr></thead>
            <tbody>
              {termRows(p.ask, counter?.ask).map((t) => (
                <tr key={t.label} className="border-t hairline"><th scope="row" className="py-1.5 text-left font-normal text-ink-2">{t.label}</th><td className="num py-1.5 text-right font-medium">{t.a}</td>{counter && <td className={cn('num py-1.5 text-right', t.changed ? 'font-semibold text-warn' : 'text-ink-3')}>{t.b}</td>}</tr>
              ))}
            </tbody>
          </table>
          {counter && <p className="mt-2 text-2xs text-ink-3">Reason sent: “{counter.reason}”</p>}
        </section>
        <section>
          <SectionTitle eyebrow="Budget" title={`${fmtMoney(cost)} at the asked CPI`} />
          <div className="text-2xs text-ink-3"><div className="flex justify-between"><span>Spent so far</span><span className="num">{fmtMoney(p.budget.spent)} of {fmtMoney(p.budget.total)}</span></div><Bar value={p.budget.spent / p.budget.total} className="mt-1" /></div>
          <p className={cn('mt-2 text-[12px]', overBudget ? 'text-warn' : 'text-ink-2')}>{overBudget ? `This request costs ${fmtMoney(cost - p.budget.total)} more than the project budget.` : `Leaves ${fmtMoney(p.budget.total - cost)} of the project budget.`} CPI cap from the rate card: ${p.budget.cpiCap.toFixed(2)}.</p>
          <h3 className="eyebrow mb-1.5 mt-4">Feasibility from SUPPLY360</h3>
          <p className="text-[12.5px]"><b className="num">{fmtNum(s.feasibility.estimatedCompletes)}</b> estimated completes from <b className="num">{fmtNum(s.feasibility.reachable)}</b> reachable{s.feasibility.shortfall ? <span className="text-warn"> · short by {fmtNum(s.feasibility.shortfall)}</span> : <span className="text-emerald"> · feasible</span>}</p>
          <Link href={`/supply/sampleon?r=${p.requestId}`} className="mt-2 inline-flex items-center gap-1 text-2xs text-primary hover:underline">Open in SAMPLEON allocation <ArrowRight size={11} /></Link>
        </section>
      </div>

      <section className="mt-4">
        <SectionTitle eyebrow="From the PROJEXA questionnaire" title="Quota mapping" />
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {p.quotas.map((q) => (
            <li key={q.id} className="flex items-center gap-2 rounded-lg border hairline px-2.5 py-1.5 text-[12px]">
              {q.mapped ? <CheckCircle2 size={13} className="shrink-0 text-emerald" aria-label="Mapped" /> : <TriangleAlert size={13} className="shrink-0 text-warn" aria-label="Not mapped" />}
              <span className="min-w-0 flex-1 truncate">{q.label}</span>
              <code className="truncate text-[10.5px] text-ink-3">{q.mapped ? q.condition : 'not mapped'}</code>
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

const termRows = (a: Ask, b?: Ask) => [
  { label: 'Completes', a: fmtNum(a.completes), b: b && fmtNum(b.completes), changed: b && b.completes !== a.completes },
  { label: 'Incidence (IR)', a: fmt.pct(a.ir), b: b && fmt.pct(b.ir), changed: b && b.ir !== a.ir },
  { label: 'Length (LOI)', a: `${a.loi} min`, b: b && `${b.loi} min`, changed: b && b.loi !== a.loi },
  { label: 'Countries', a: <CountryChips codes={a.countries} max={4} />, b: b && <CountryChips codes={b.countries} max={4} />, changed: false },
  { label: 'Fieldwork ends', a: a.end, b: b?.end, changed: b && b.end !== a.end },
  { label: 'CPI', a: `$${a.cpi.toFixed(2)}`, b: b && `$${b.cpi.toFixed(2)}`, changed: b && b.cpi !== a.cpi },
];

function CounterDialog({ open, onOpenChange, p, onSend }: { open: boolean; onOpenChange: (v: boolean) => void; p: ProjexaRequest; onSend: (a: Ask, reason: string) => void }) {
  const s = sampleonRequests.find((x) => x.id === p.requestId)!;
  const [ask, setAsk] = useState<Ask>(p.ask);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setAsk({ ...p.ask, completes: s.feasibility.shortfall ? Math.min(p.ask.completes, s.feasibility.estimatedCompletes) : p.ask.completes }); setReason(s.feasibility.shortfall ? `Feasibility supports about ${s.feasibility.estimatedCompletes} completes at this IR.` : ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const errs: Partial<Record<keyof Ask | 'reason', string>> = {
    ...(ask.completes < 1 ? { completes: 'At least 1' } : {}),
    ...(ask.ir <= 0 || ask.ir > 1 ? { ir: 'Between 1% and 100%' } : {}),
    ...(ask.loi < 1 || ask.loi > 180 ? { loi: '1 to 180 minutes' } : {}),
    ...(!ask.end || ask.end < TODAY ? { end: 'Must be today or later' } : {}),
    ...(ask.cpi <= 0 ? { cpi: 'More than $0' } : {}),
    ...(reason.trim().length < 10 ? { reason: 'Tell the project manager why, in a sentence' } : {}),
  };
  const changes = termRows(p.ask, ask).filter((t) => t.changed);
  const field = (k: keyof Ask, label: string, input: React.ReactNode) => (
    <label className="block text-2xs text-ink-3">{label}{input}{errs[k] && <span className="mt-0.5 block text-danger">{errs[k]}</span>}</label>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Counter-propose on ${p.projectId}`} description={`Sent to ${p.manager} in PROJEXA. The request waits until they accept or change it.`}>
        <div className="grid grid-cols-2 gap-3">
          {field('completes', 'Completes', <input type="number" className={cn(inputCls, 'mt-1')} aria-invalid={!!errs.completes} value={ask.completes} onChange={(e) => setAsk({ ...ask, completes: Number(e.target.value) })} />)}
          {field('ir', 'Incidence (%)', <input type="number" step={1} className={cn(inputCls, 'mt-1')} aria-invalid={!!errs.ir} value={Math.round(ask.ir * 100)} onChange={(e) => setAsk({ ...ask, ir: Number(e.target.value) / 100 })} />)}
          {field('loi', 'Length (minutes)', <input type="number" className={cn(inputCls, 'mt-1')} aria-invalid={!!errs.loi} value={ask.loi} onChange={(e) => setAsk({ ...ask, loi: Number(e.target.value) })} />)}
          {field('end', 'Fieldwork ends', <input type="date" className={cn(inputCls, 'mt-1')} aria-invalid={!!errs.end} value={ask.end} onChange={(e) => setAsk({ ...ask, end: e.target.value })} />)}
          {field('cpi', 'CPI ($)', <input type="number" step={0.05} className={cn(inputCls, 'mt-1')} aria-invalid={!!errs.cpi} value={ask.cpi} onChange={(e) => setAsk({ ...ask, cpi: Number(e.target.value) })} />)}
        </div>
        <label className="mt-3 block text-2xs text-ink-3">Reason<textarea rows={2} className={cn(inputCls, 'mt-1 h-auto py-2')} aria-invalid={!!errs.reason} value={reason} onChange={(e) => setReason(e.target.value)} />{errs.reason && <span className="mt-0.5 block text-danger">{errs.reason}</span>}</label>
        <div className="mt-3 rounded-xl bg-surface-2/50 p-2.5 text-[12px]">
          <div className="eyebrow mb-1">Changes</div>
          {changes.length ? <ul className="space-y-0.5">{changes.map((c) => <li key={c.label}>{c.label}: <span className="text-ink-3 line-through">{c.a}</span> → <b>{c.b}</b></li>)}</ul> : <p className="text-ink-3">Nothing changed yet.</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
          <Button size="sm" variant="primary" disabled={Object.keys(errs).length > 0 || changes.length === 0} onClick={() => onSend(ask, reason.trim())}>Send counter-proposal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const declineReasons = ['Audience not feasible in our panels', 'Healthcare criteria need a specialist partner', 'CPI below the rate card', 'Fieldwork dates too short'];
function DeclineDialog({ open, onOpenChange, p, onDecline }: { open: boolean; onOpenChange: (v: boolean) => void; p: ProjexaRequest; onDecline: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setReason(''); onOpenChange(v); }}>
      <DialogContent title={`Decline ${p.projectId}?`} description="PROJEXA marks the request as rejected and the project manager sees your reason. They can raise a new request.">
        <fieldset className="space-y-1.5"><legend className="mb-1 text-2xs text-ink-3">Reason</legend>
          {declineReasons.map((r) => <label key={r} className="flex items-center gap-2 text-[12.5px]"><input type="radio" name="decline" checked={reason === r} onChange={() => setReason(r)} className="accent-[rgb(var(--primary))]" />{r}</label>)}
        </fieldset>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
          <Button size="sm" variant="danger" disabled={!reason} onClick={() => { onDecline(); setReason(''); }}>Decline request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

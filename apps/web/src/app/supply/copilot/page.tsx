'use client';
/**
 * Screen 37 · AI Copilot Command Center. Ask in plain language; answers come back as structured
 * cards (a count with its panel split, a table, bars, or an explanation with sources), each linking
 * to the screen where the number can be checked. Anything the copilot wants to change lands in the
 * proposed-actions tray and waits for a person; medium- and high-risk actions ask for confirmation.
 * The context rail shows what the conversation is about (country, panel, segment) and is reused by
 * follow-up questions until cleared.
 * Integration: `POST /ai/copilot` through the AI gateway (planned); in demo mode answers come from a
 * local, deterministic router over the same seeded data the screens use.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, CornerDownLeft, Sparkles, Trash2, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { copilot, copilotStarters, type AnswerCard, type ContextChip, type CopilotReply, type ProposedAction } from '@/lib/supply/platform';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('copilot')!;
type Turn = { id: string; q: string; a: CopilotReply | null };
const riskTone = { low: 'emerald', medium: 'warn', high: 'danger' } as const;

export default function Copilot() {
  const toast = useOS((s) => s.toast);
  const reduced = useOS((s) => s.motion === 'reduced');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [ctx, setCtx] = useState<ContextChip[]>([]);
  const [tray, setTray] = useState<ProposedAction[]>([]);
  const [done, setDone] = useState<(ProposedAction & { verdict: 'approved' | 'dismissed' })[]>([]);
  const [confirm, setConfirm] = useState<ProposedAction | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => !t.a);

  useEffect(() => { end.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' }); }, [turns, reduced]);

  const ask = (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    const id = `t-${Date.now()}`;
    setTurns((t) => [...t, { id, q: text, a: null }]);
    setInput('');
    setTimeout(() => {
      const a = copilot(text, ctx);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, a } : x)));
      if (a.context.length) setCtx((c) => [...c.filter((x) => !a.context.some((n) => n.kind === x.kind)), ...a.context]);
      if (a.actions.length) setTray((l) => [...a.actions, ...l]);
    }, reduced ? 50 : 650);
  };
  const resolve = (a: ProposedAction, verdict: 'approved' | 'dismissed') => {
    setTray((l) => l.filter((x) => x.id !== a.id));
    setDone((d) => [{ ...a, verdict }, ...d]);
    toast(verdict === 'approved' ? `Approved: ${a.title}` : 'Dismissed', verdict === 'approved' ? 'ok' : 'info');
  };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="AI copilot" subtitle="Ask about audiences, fieldwork, rewards and quality. Answers link to where you can check them; anything that changes data waits for your approval." />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel className="flex min-h-[620px] flex-col p-0">
          <div className="flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="mx-auto max-w-lg py-10 text-center">
                <Sparkles size={28} className="mx-auto text-purple" aria-hidden />
                <h2 className="mt-3 font-display text-lg font-semibold">What do you want to know?</h2>
                <p className="mt-1 text-[13px] text-ink-3">Numbers come from the same data as the rest of SUPPLY360. Actions are only proposed; you approve them.</p>
                <ul className="mt-5 grid gap-2 sm:grid-cols-2">{copilotStarters.map((s) => <li key={s}><button onClick={() => ask(s)} className="w-full rounded-xl border hairline px-3 py-2 text-left text-[12.5px] hover:border-primary/40 hover:bg-surface-2/50">{s}</button></li>)}</ul>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex justify-end gap-2"><p className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary/12 px-3.5 py-2 text-[13px]">{t.q}</p><User size={16} className="mt-2 shrink-0 text-ink-3" aria-label="You" /></div>
                <div className="flex gap-2">
                  <Sparkles size={16} className="mt-1 shrink-0 text-purple" aria-label="Copilot" />
                  <div className="min-w-0 flex-1 space-y-3">
                    {!t.a ? <p className="text-[13px] text-ink-3">Looking that up…</p> : (
                      <>
                        <p className="text-[13px] leading-relaxed">{t.a.text}</p>
                        {t.a.cards.map((c, i) => <Card key={i} c={c} />)}
                        {t.a.actions.length > 0 && <p className="text-2xs text-ink-3">{t.a.actions.length === 1 ? 'One action is' : `${t.a.actions.length} actions are`} waiting in the tray for your approval.</p>}
                        {!t.a.cards.length && !t.a.actions.length && t.a.context.length === 0 && <div className="flex flex-wrap gap-1.5">{copilotStarters.slice(0, 4).map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border hairline px-2.5 py-1 text-2xs hover:border-primary/40">{s}</button>)}</div>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="flex items-center gap-2 border-t hairline p-3" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <label htmlFor="copilot-q" className="sr-only">Ask the copilot</label>
            <input id="copilot-q" className={inputCls} value={input} onChange={(e) => setInput(e.target.value)} placeholder={ctx.length ? `Ask a follow-up (context: ${ctx.map((c) => c.label).join(', ')})` : 'e.g. How many reachable nurses in the UK?'} autoComplete="off" />
            <Button type="submit" size="sm" disabled={!input.trim() || busy}><CornerDownLeft size={13} /> Ask</Button>
          </form>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="Needs your approval" title={`Proposed actions (${tray.length})`} />
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {tray.map((a) => (
                  <motion.li key={a.id} layout={!reduced} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} className="rounded-xl border hairline p-3">
                    <div className="flex items-start gap-2"><span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{a.title}</span><Badge tone={riskTone[a.risk]}>{a.risk} risk</Badge></div>
                    <p className="mt-1 text-2xs text-ink-3">{a.detail}</p>
                    <p className="mt-1 text-2xs text-ink-2">Impact: {a.impact}</p>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="xs" variant="success" onClick={() => (a.risk === 'low' ? resolve(a, 'approved') : setConfirm(a))}><Check size={12} /> Approve</Button>
                      <Button size="xs" variant="ghost" onClick={() => resolve(a, 'dismissed')}><X size={12} /> Dismiss</Button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
              {tray.length === 0 && <li className="text-2xs text-ink-3">Nothing waiting. The copilot never changes data on its own.</li>}
            </ul>
            {done.length > 0 && <>
              <h3 className="eyebrow mb-1.5 mt-4">This session</h3>
              <ul className="space-y-1">{done.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 text-2xs"><span className="truncate">{d.title}</span>{d.verdict === 'approved' ? <Link href={d.href} className="shrink-0 font-semibold text-emerald hover:underline">Approved</Link> : <span className="shrink-0 text-ink-3">Dismissed</span>}</li>)}</ul>
            </>}
          </Panel>

          <Panel className="p-4">
            <SectionTitle eyebrow="Follow-ups use this" title="Context" actions={ctx.length > 0 && <Button size="xs" variant="ghost" onClick={() => setCtx([])}><Trash2 size={12} /> Clear</Button>} />
            <ul className="flex flex-wrap gap-1.5">
              {ctx.map((c) => (
                <li key={c.kind} className="inline-flex items-center gap-1 rounded-full bg-surface-2/70 py-0.5 pl-2.5 pr-1 text-2xs ring-1 ring-inset ring-ink-3/20">
                  <span className="text-ink-3">{c.kind}:</span> <span className="font-medium">{c.label}</span>
                  <button aria-label={`Remove ${c.label} from context`} onClick={() => setCtx((l) => l.filter((x) => x.kind !== c.kind))} className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-ink-3/15"><X size={11} /></button>
                </li>
              ))}
              {ctx.length === 0 && <li className="text-2xs text-ink-3">Empty. Mention a country, panel or audience and it is kept here.</li>}
            </ul>
          </Panel>
        </div>
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} tone="primary" title="Approve this action?"
        body={confirm ? <><b>{confirm.title}</b><br />{confirm.detail}<br /><span className="text-ink-3">Impact: {confirm.impact}</span></> : ''}
        confirmLabel="Approve" onConfirm={() => { if (confirm) resolve(confirm, 'approved'); setConfirm(null); }} />
    </div>
  );
}

function Card({ c }: { c: AnswerCard }) {
  const link = 'href' in c && c.href ? <Link href={c.href} className="mt-2 inline-flex items-center gap-1 text-2xs text-primary hover:underline">Check on the screen <ArrowRight size={11} /></Link> : null;
  if (c.kind === 'count') {
    const total = c.value || 1;
    return (
      <section className="rounded-xl border hairline bg-surface-2/30 p-3" aria-label={c.title}>
        <div className="eyebrow">{c.title}</div>
        <div className="num font-jakarta text-2xl font-bold">{fmtNum(c.value)}</div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full" aria-hidden>{c.breakdown.map((b) => <span key={b.label} style={{ width: `${(b.value / total) * 100}%`, background: b.color }} />)}</div>
        <ul className="mt-1.5 flex flex-wrap gap-3 text-2xs text-ink-2">{c.breakdown.map((b) => <li key={b.label} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden />{b.label} <b className="num">{fmtNum(b.value)}</b></li>)}</ul>
        <p className="mt-1.5 text-2xs text-ink-3">{c.note}</p>{link}
      </section>
    );
  }
  if (c.kind === 'table') return (
    <section className="rounded-xl border hairline bg-surface-2/30 p-3">
      <div className="eyebrow mb-1.5">{c.title}</div>
      <div className="overflow-x-auto"><table className="w-full text-[12px]"><caption className="sr-only">{c.title}</caption>
        <thead><tr className="text-left text-2xs text-ink-3">{c.columns.map((h, i) => <th key={h} scope="col" className={cn('py-1 font-semibold', i >= 2 && i <= 3 && 'text-right', i === 4 && 'pl-4')}>{h}</th>)}</tr></thead>
        <tbody>{c.rows.map((r, i) => <tr key={i} className="border-t hairline">{r.map((v, j) => <td key={j} className={cn('py-1.5', j >= 2 && j <= 3 && 'num text-right', j === 4 && cn('pl-4', v === 'At risk' ? 'text-danger' : 'text-warn'))}>{typeof v === 'number' ? fmtNum(v) : v}</td>)}</tr>)}</tbody>
      </table></div>
      {c.rows.length === 0 && <p className="text-2xs text-ink-3">Nothing behind pace right now.</p>}
      <p className="mt-1.5 text-2xs text-ink-3">{c.note}</p>{link}
    </section>
  );
  if (c.kind === 'bars') {
    const max = Math.max(...c.bars.map((b) => b.value), 1);
    return (
      <section className="rounded-xl border hairline bg-surface-2/30 p-3">
        <div className="eyebrow mb-2">{c.title}</div>
        <ul className="space-y-1">{c.bars.map((b) => <li key={b.label} className="flex items-center gap-2 text-[12px]"><span className="w-10 font-mono text-[11px] font-semibold">{b.label}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-3/10"><span className="block h-full rounded-full bg-primary" style={{ width: `${(b.value / max) * 100}%` }} /></span><span className="num w-20 text-right">{c.unit === 'USD' ? `$${fmtNum(b.value)}` : fmtNum(b.value)}</span></li>)}</ul>
        <p className="mt-1.5 text-2xs text-ink-3">{c.note}</p>{link}
      </section>
    );
  }
  return (
    <section className="rounded-xl border hairline bg-surface-2/30 p-3">
      <div className="eyebrow mb-1.5">{c.title}</div>
      <ul className="space-y-1 text-[12.5px]">{c.body.map((b) => <li key={b}>{b}</li>)}</ul>
      <p className="mt-2 text-2xs text-ink-3">Sources: {c.sources.join(' · ')}</p>{link}
    </section>
  );
}

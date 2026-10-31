'use client';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { Database, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { route, suggestions, type AssistantAnswer } from '@/lib/assistant';
import { useOS } from '@/lib/store';
import { Button, DemoBadge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Msg = { role: 'user'; text: string } | { role: 'ai'; a: AssistantAnswer };

export function AnswerView({ a }: { a: AssistantAnswer }) {
  return (
    <div className="space-y-3">
      <div className="font-display text-[13px] font-semibold">{a.title}</div>
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{a.text}</p>
      {a.table && a.table.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border hairline">
          <table className="w-full text-left text-2xs">
            <thead className="bg-surface-2/50 text-ink-3"><tr>{a.table.columns.map((c) => <th key={c} className="px-2.5 py-1.5 font-semibold">{c}</th>)}</tr></thead>
            <tbody>{a.table.rows.slice(0, 8).map((r, i) => <tr key={i} className="border-t hairline">{r.map((c, j) => <td key={j} className="num px-2.5 py-1.5 text-ink">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
        <Database size={11} /> {a.sources.length ? `Traced to ${a.sources.length} record${a.sources.length > 1 ? 's' : ''}` : 'No records used'}
        {a.link && <Link href={a.link.href} className="ml-auto font-semibold text-cyan">{a.link.label} →</Link>}
      </div>
    </div>
  );
}

export function useAssistant() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const ask = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: 'user', text }]);
    setThinking(true);
    const { role, projects, opportunities } = useOS.getState();
    setTimeout(() => { setMsgs((m) => [...m, { role: 'ai', a: route(text, { role, projects, opportunities }) }]); setThinking(false); }, 380);
  };
  return { msgs, thinking, ask };
}

export function AssistantThread({ compact }: { compact?: boolean }) {
  const { msgs, thinking, ask } = useAssistant();
  const [q, setQ] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current && msgs.length) box.current.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [msgs, thinking]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={box} className={cn('min-h-0 flex-1 space-y-3 overflow-y-auto', compact ? 'max-h-[340px]' : 'max-h-[560px]')}>
        {!msgs.length && (
          <div className="space-y-2">
            <p className="text-[13px] text-ink-2">Ask about projects, vendors, revenue and fieldwork. Answers are computed from platform records and show their sources.</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border hairline bg-surface-2/40 px-3 py-1 text-2xs text-ink-2 transition-colors hover:border-cyan/50 hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-r from-blue to-purple px-3.5 py-2 text-[13px] text-white">{m.text}</div>
          ) : (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="panel-solid p-3.5"><AnswerView a={m.a} /></motion.div>
          ),
        )}
        {thinking && <div className="flex gap-1 px-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-cyan" style={{ animationDelay: `${i * 150}ms` }} />)}</div>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); setQ(''); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Sampledge AI…" aria-label="Ask the assistant"
          className="h-10 flex-1 rounded-xl border hairline bg-surface-2/40 px-3 text-[13px] outline-none focus:border-cyan/60" />
        <Button variant="primary" size="icon" type="submit" aria-label="Send"><Send size={15} /></Button>
      </form>
      <div className="mt-2 text-[10px] text-ink-3">Rule-based demo assistant · no language model connected · never fabricates missing metrics</div>
    </div>
  );
}

export function Assistant() {
  const open = useOS((s) => s.assistantOpen);
  const setOpen = useOS((s) => s.setAssistant);
  return (
    <AnimatePresence>
      {open && (
        <motion.aside initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ type: 'spring', bounce: 0.1, duration: 0.45 }}
          className="panel fixed bottom-4 right-4 top-20 z-50 flex w-[min(440px,calc(100vw-2rem))] flex-col p-5" aria-label="Sampledge AI assistant">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-cyan via-blue to-purple text-white"><Sparkles size={15} /></span>
            <div className="flex-1">
              <div className="font-display text-sm font-semibold">Sampledge AI</div>
              <div className="text-2xs text-ink-3">Executive assistant</div>
            </div>
            <DemoBadge />
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={16} /></Button>
          </div>
          <AssistantThread />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

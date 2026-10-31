'use client';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, RotateCcw, Smartphone, Monitor } from 'lucide-react';
import { useState } from 'react';
import { answer as step, displayOptions, pipe, start, type Answer, type Question, type RunState, type SurveyDef } from '@/lib/core';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Badge, Button, Segmented } from '@/components/ui/primitives';

export function QuestionInput({ q, seed, value, onChange }: { q: Question; seed: string; value: Answer | undefined; onChange: (v: Answer) => void }) {
  const opts = displayOptions(q, seed);
  const choice = 'w-full rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors';
  switch (q.type) {
    case 'single': case 'likert':
      return <div className="space-y-1.5">{opts.map((o) => <button key={o.code} onClick={() => onChange(o.code)} className={cn(choice, value === o.code ? 'border-cyan bg-cyan/10' : 'hairline hover:border-blue/50')}>{o.label}</button>)}</div>;
    case 'dropdown':
      return <select className="h-10 w-full rounded-xl border hairline bg-surface-2/40 px-3 text-[13px]" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Select…</option>{opts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select>;
    case 'multi': {
      const cur = (value as string[]) ?? [];
      return <div className="space-y-1.5">{opts.map((o) => { const on = cur.includes(o.code); return <button key={o.code} onClick={() => onChange(o.exclusive ? (on ? [] : [o.code]) : on ? cur.filter((x) => x !== o.code) : [...cur.filter((x) => !q.options!.find((y) => y.code === x)?.exclusive), o.code])} className={cn(choice, 'flex items-center gap-2', on ? 'border-cyan bg-cyan/10' : 'hairline hover:border-blue/50')}><span className={cn('grid h-4 w-4 place-items-center rounded border text-[10px]', on ? 'border-cyan bg-cyan text-bg' : 'hairline')}>{on ? '✓' : ''}</span>{o.label}</button>; })}</div>;
    }
    case 'numeric': case 'slider':
      return <input type="number" min={q.min} max={q.max} className="h-10 w-full rounded-xl border hairline bg-surface-2/40 px-3 text-[13px]" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)} placeholder={`${q.min ?? 0}–${q.max ?? 100}`} />;
    case 'text':
      return <textarea rows={3} className="w-full rounded-xl border hairline bg-surface-2/40 px-3 py-2 text-[13px]" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'nps': case 'rating': {
      const lo = q.min ?? (q.type === 'nps' ? 0 : 1), hi = q.max ?? (q.type === 'nps' ? 10 : 5);
      return (
        <div>
          <div className="flex flex-wrap gap-1">{Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => <button key={n} onClick={() => onChange(n)} className={cn('h-9 min-w-9 flex-1 rounded-lg border text-[13px] font-semibold', value === n ? 'border-cyan bg-cyan text-bg' : 'hairline hover:border-blue/50')}>{n}</button>)}</div>
          <div className="mt-1 flex justify-between text-2xs text-ink-3"><span>{q.type === 'nps' ? 'Not at all likely' : 'Very dissatisfied'}</span><span>{q.type === 'nps' ? 'Extremely likely' : 'Very satisfied'}</span></div>
        </div>
      );
    }
    case 'matrix': {
      const cur = (value as Record<string, string>) ?? {};
      return (
        <div className="space-y-3">{q.rows!.map((r) => (
          <div key={r.code}><div className="mb-1 text-[12.5px] font-medium">{r.label}</div>
            <div className="grid grid-cols-4 gap-1">{opts.map((o) => <button key={o.code} onClick={() => { const n = { ...cur, [r.code]: o.code }; onChange(n); }} className={cn('rounded-lg border px-1 py-1.5 text-[10.5px]', cur[r.code] === o.code ? 'border-cyan bg-cyan/15' : 'hairline')}>{o.label}</button>)}</div>
          </div>
        ))}</div>
      );
    }
    case 'ranking': {
      const cur = (value as string[]) ?? opts.map((o) => o.code);
      const mv = (i: number, d: number) => { const n = [...cur]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
      return <ol className="space-y-1.5">{cur.map((c, i) => <li key={c} className="flex items-center gap-2 rounded-xl border hairline px-3 py-2 text-[13px]"><span className="num w-5 font-bold text-cyan">{i + 1}</span><span className="flex-1">{q.options!.find((o) => o.code === c)?.label}</span><button aria-label="Move up" disabled={i === 0} onClick={() => mv(i, -1)} className="disabled:opacity-20"><ArrowUp size={14} /></button><button aria-label="Move down" disabled={i === cur.length - 1} onClick={() => mv(i, 1)} className="disabled:opacity-20"><ArrowDown size={14} /></button></li>)}</ol>;
    }
    default:
      return null;
  }
}

export function SurveyPreview({ def }: { def: SurveyDef }) {
  const record = useOS((s) => s.recordResponse);
  const allResponses = useOS((s) => s.responses);
  const responses = allResponses.filter((r) => r.surveyId === def.id);
  const [run, setRun] = useState<RunState>(() => start(def));
  const [val, setVal] = useState<Answer | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | string>('en');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [seed, setSeed] = useState(() => `resp-${Math.random().toString(36).slice(2, 7)}`);
  const q = def.questions.find((x) => x.id === run.cursor);
  const langs = ['en', ...Object.keys(def.languages ?? {})];
  const text = q ? pipe((lang !== 'en' && def.languages?.[lang]?.[q.id]) || q.text, def, run.answers) : '';
  const missingTr = q && lang !== 'en' && !def.languages?.[lang]?.[q.id];

  const next = () => {
    if (!q) return;
    const v = q.type === 'info' ? 'seen' : q.type === 'ranking' && val === undefined ? displayOptions(q, seed).map((o) => o.code) : val;
    const r = step(def, run, q.id, v as Answer);
    if (r.error) { setErr(r.error); return; }
    setErr(null); setVal(undefined); setRun(r);
    if (r.outcome) record(def.id, r.outcome, r.answers);
  };
  const restart = () => { setRun(start(def)); setVal(undefined); setErr(null); setSeed(`resp-${Math.random().toString(36).slice(2, 7)}`); };
  const progress = run.path.length / def.questions.length;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col items-center">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented size="sm" label="device" value={device} onChange={setDevice} options={[{ value: 'mobile', label: <span className="flex items-center gap-1"><Smartphone size={11} />Mobile</span> }, { value: 'desktop', label: <span className="flex items-center gap-1"><Monitor size={11} />Desktop</span> }]} />
          <Segmented size="sm" label="lang" value={lang} onChange={setLang} options={langs.map((l) => ({ value: l, label: l.toUpperCase() }))} />
          <Button size="sm" variant="ghost" onClick={restart}><RotateCcw size={12} /> New respondent</Button>
        </div>
        <div className={cn('relative overflow-hidden border-[6px] border-surface-2 bg-bg shadow-lift transition-all duration-500', device === 'mobile' ? 'h-[620px] w-[340px] rounded-[42px]' : 'h-[520px] w-full max-w-[760px] rounded-2xl')}>
          <div className="h-1 bg-surface-2"><motion.div className="h-full bg-gradient-to-r from-blue to-cyan" animate={{ width: `${(run.outcome ? 1 : progress) * 100}%` }} /></div>
          <div className="flex h-[calc(100%-4px)] flex-col overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between text-2xs text-ink-3"><span>{def.name}</span><Badge tone="orange">Preview · test data</Badge></div>
            <AnimatePresence mode="wait">
              {run.outcome ? (
                <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="my-auto text-center">
                  <div className={cn('mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-2xl', run.outcome === 'complete' ? 'bg-emerald/15 text-emerald' : run.outcome === 'screenout' ? 'bg-danger/15 text-danger' : 'bg-orange/15 text-orange')}>{run.outcome === 'complete' ? '✓' : run.outcome === 'screenout' ? '⨯' : '◐'}</div>
                  <div className="font-display text-lg font-semibold">{run.outcome === 'complete' ? 'Survey complete' : run.outcome === 'screenout' ? 'Screened out' : 'Quota full'}</div>
                  <p className="mt-1 text-[12.5px] text-ink-3">Response recorded as {run.outcome}{run.outcome === 'complete' ? ' and quota counters updated' : ''}.</p>
                  <Button className="mt-4" variant="primary" onClick={restart}>Start another respondent</Button>
                </motion.div>
              ) : q ? (
                <motion.div key={q.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }} className="flex flex-1 flex-col">
                  <div className="mb-1 font-mono text-2xs text-ink-3">{q.id}{missingTr && <span className="ml-2 text-orange">translation missing, showing EN</span>}</div>
                  <h3 className="mb-4 font-display text-[16px] font-semibold leading-snug">{text}</h3>
                  <QuestionInput q={q} seed={seed} value={val} onChange={setVal} />
                  {err && <div role="alert" className="mt-3 text-[12px] text-danger">{err}</div>}
                  <Button variant="primary" className="mt-auto w-full" onClick={next}>{q.type === 'info' ? 'Finish' : 'Next'}</Button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="panel-solid p-4 text-[12px]">
          <div className="eyebrow mb-2">Execution trace</div>
          <div className="text-2xs text-ink-3">Respondent seed <span className="font-mono">{seed}</span> · definition v{def.version}</div>
          <ol className="mt-2 space-y-1">
            {run.path.map((id) => <li key={id} className="flex gap-2"><span className="w-8 font-mono text-cyan">{id}</span><span className="truncate text-ink-2">{JSON.stringify(run.answers[id])}</span></li>)}
            {q && !run.outcome && <li className="flex gap-2"><span className="w-8 font-mono text-magenta">{q.id}</span><span className="text-ink-3">current</span></li>}
          </ol>
        </div>
        <div className="panel-solid p-4 text-[12px]">
          <div className="eyebrow mb-2">Quotas (live)</div>
          {def.quotas.map((c) => <div key={c.id} className="num flex justify-between py-0.5"><span className="text-ink-2">{c.label}</span><span className={c.count >= c.target ? 'text-danger' : ''}>{c.count}/{c.target}</span></div>)}
        </div>
        <div className="panel-solid p-4 text-[12px]">
          <div className="eyebrow mb-2">Responses collected in preview ({responses.length})</div>
          {responses.length ? responses.slice(0, 6).map((r) => <div key={r.id} className="flex justify-between py-0.5"><Badge tone={r.outcome === 'complete' ? 'emerald' : r.outcome === 'screenout' ? 'danger' : 'orange'}>{r.outcome}</Badge><span className="text-ink-3">v{r.version} · {new Date(r.at).toLocaleTimeString()}</span></div>) : <div className="text-ink-3">Take the survey to record a response.</div>}
        </div>
      </div>
    </div>
  );
}

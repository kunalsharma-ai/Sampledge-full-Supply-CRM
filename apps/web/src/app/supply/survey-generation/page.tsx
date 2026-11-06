'use client';
/**
 * Screen 17 · AI Survey Generation. Brief on the left, the generated questionnaire in the centre
 * (each question carries the reason it was included, and can be edited, removed or redrafted),
 * quality checks on the right. Nothing is published from here: the draft goes to Survey Studio
 * for review.
 * Demo: questions come from a local, deterministic drafter. Live: `POST /ai/survey-draft`
 * (planned, next to the existing `/ai/questionnaire` structurer) behind the AI gateway.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Field, Panel, Segmented, buttonVariants, inputCls } from '@/components/ui/primitives';
import { ValidatedInput } from '@/components/ui/forms';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { draftSurvey, type DraftQuestion } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn } from '@/lib/utils';

const screen = screenBySlug('survey-generation')!;
const typeLabel: Record<DraftQuestion['type'], string> = { single: 'Single choice', multi: 'Multiple choice', scale: 'Scale 1–5', open: 'Open text', grid: 'Grid', numeric: 'Number' };
const secondsPer: Record<DraftQuestion['type'], number> = { single: 12, multi: 18, scale: 8, open: 45, grid: 40, numeric: 10 };

export default function SurveyGeneration() {
  const toast = useOS((s) => s.toast);
  const reduced = useOS((s) => s.motion === 'reduced');
  const [topic, setTopic] = useState('cloud accounting software');
  const [audience, setAudience] = useState<'consumer' | 'b2b' | 'health'>('b2b');
  const [goal, setGoal] = useState('Profile small-business buyers so we can target future studies');
  const [length, setLength] = useState(5);
  const [qs, setQs] = useState<DraftQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [openWhy, setOpenWhy] = useState<string | null>(null);

  const generate = () => {
    setBusy(true); setQs([]);
    const out = draftSurvey({ topic, audience, goal, length });
    if (reduced) { setQs(out); setBusy(false); return; }
    out.forEach((q, i) => setTimeout(() => { setQs((s) => [...s, q]); if (i === out.length - 1) setBusy(false); }, 250 + i * 160));
  };
  const redraft = (q: DraftQuestion) => setQs((s) => s.map((x) => (x.id === q.id ? { ...x, text: x.text.replace(/^(How|Which|What)/, (m) => ({ How: 'To what extent', Which: 'Which, if any,', What: 'What would you say is' }[m] ?? m)), flags: x.flags.filter((f) => !f.startsWith('Possibly')) } : x)));
  const loiSec = qs.reduce((a, q) => a + secondsPer[q.type] + (q.options?.length ?? 0) * 1.5, 0);
  const checks = qs.length ? [
    { ok: Math.abs(loiSec / 60 - length) <= 2, label: `Estimated length ${(loiSec / 60).toFixed(1)} min (target ${length})` },
    { ok: qs.some((q) => /select “Somewhat agree”/.test(q.text)), label: 'Includes an attention check' },
    { ok: qs.filter((q) => q.type === 'open').length <= 2, label: 'Two or fewer open-ended questions' },
    { ok: qs.every((q) => (q.options?.length ?? 0) <= 8), label: 'No list longer than 8 options (mobile)' },
    { ok: qs.every((q) => q.flags.length === 0), label: `${qs.reduce((a, q) => a + q.flags.length, 0)} wording warnings` },
  ] : [];

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="AI survey drafting" subtitle="Describe the survey; get a first draft with the reason for every question. You review it in Survey Studio before anything reaches members." />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_280px]">
        <Panel className="space-y-3 p-4">
          <SectionTitle eyebrow="Brief" title="What should it find out?" />
          <ValidatedInput label="Topic" value={topic} onChange={setTopic} validate={(v) => (v.trim().length < 3 ? 'Describe the topic in a few words' : null)} />
          <Field label="Audience"><Segmented label="Audience" size="sm" value={audience} onChange={setAudience} options={[{ value: 'consumer', label: 'Consumer' }, { value: 'b2b', label: 'B2B' }, { value: 'health', label: 'Healthcare' }]} /></Field>
          <Field label="Goal"><textarea className={cn(inputCls, 'h-auto py-2')} rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
          <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-3">Target length: <span className="num text-ink">{length} min</span>
            <input type="range" min={2} max={15} value={length} onChange={(e) => setLength(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--primary))]" /></label>
          <Button className="w-full" disabled={busy || topic.trim().length < 3} onClick={generate}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {qs.length ? 'Draft again' : 'Draft survey'}</Button>
          <Badge tone="neutral">Demo drafter runs in your browser</Badge>
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Draft" title={qs.length ? `${qs.length} questions` : 'No draft yet'} />
          {qs.length === 0 && !busy && <p className="py-16 text-center text-[13px] text-ink-3">Fill in the brief and choose Draft survey.</p>}
          <ol className="space-y-2" aria-live="polite" aria-busy={busy}>
            <AnimatePresence initial={false}>
              {qs.map((q) => (
                <motion.li key={q.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="rounded-xl border hairline bg-surface-2/30 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-md bg-primary/12 px-1.5 font-mono text-[10.5px] font-bold text-primary">{q.id}</span>
                    <div className="min-w-0 flex-1">
                      <textarea aria-label={`${q.id} wording`} rows={Math.max(1, Math.ceil(q.text.length / 70))} value={q.text} onChange={(e) => setQs((s) => s.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))} className="w-full resize-none bg-transparent text-[13px] font-medium leading-snug outline-none focus:underline" />
                      <div className="mt-1 text-2xs text-ink-3">{typeLabel[q.type]}</div>
                      {q.options && <div className="mt-1.5 flex flex-wrap gap-1">{q.options.map((o) => <span key={o} className="rounded-md bg-surface px-1.5 py-0.5 text-2xs ring-1 ring-inset ring-ink-3/15">{o}</span>)}</div>}
                      {q.flags.map((f) => <div key={f} className="mt-1.5 flex items-center gap-1 text-2xs text-warn"><AlertTriangle size={11} />{f}</div>)}
                      <button onClick={() => setOpenWhy(openWhy === q.id ? null : q.id)} aria-expanded={openWhy === q.id} className="mt-1.5 flex items-center gap-1 text-2xs font-semibold text-primary"><ChevronDown size={11} className={cn('transition-transform', openWhy === q.id && 'rotate-180')} /> Why this question</button>
                      {openWhy === q.id && <p className="mt-1 text-[12px] text-ink-2">{q.rationale}</p>}
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label={`Redraft ${q.id}`} onClick={() => redraft(q)}><RefreshCw size={12} /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${q.id}`} onClick={() => setQs((s) => s.filter((x) => x.id !== q.id))}><Trash2 size={12} /></Button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="Quality checks" title={qs.length ? `${checks.filter((c) => c.ok).length} of ${checks.length} pass` : 'Waiting for a draft'} />
            <ul className="space-y-1.5 text-[12.5px]">
              {checks.map((c) => <li key={c.label} className="flex items-start gap-2">{c.ok ? <CheckCircle2 size={14} className="mt-px shrink-0 text-emerald" /> : <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />}<span>{c.label}</span></li>)}
            </ul>
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="Next step" title="Review in Survey Studio" />
            <p className="text-2xs text-ink-3">The draft opens as a new, unpublished survey. Logic, translations and quotas are set there.</p>
            <Link href="/survey-studio" aria-disabled={!qs.length} onClick={(e) => { if (!qs.length) { e.preventDefault(); return; } toast(`${qs.length} questions sent to Survey Studio as a draft`, 'ok'); }}
              className={cn(buttonVariants({ size: 'sm' }), 'mt-3 w-full', !qs.length && 'pointer-events-none opacity-50')}>Open draft in Survey Studio</Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}

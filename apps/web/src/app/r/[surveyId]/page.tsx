'use client';
import { CheckCircle2, Loader2, LockKeyhole, Users, XCircle } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Answer, Option, Question } from '@/lib/core';
import { api, ApiError } from '@/lib/api';
import { QuestionInput } from '@/components/survey/preview';
import { Button } from '@/components/ui/primitives';
import { Logo } from '@/components/shell/logo';

type Rendered = { question: Question & { options?: Option[] }; progress: number };
type Step = { responseId: string; outcome?: 'complete' | 'screenout' | 'overquota' | null; preview?: boolean; redirect?: string | null } & Partial<Rendered>;

const endings = {
  complete: { icon: CheckCircle2, tone: 'text-emerald', title: 'Thank you', body: 'Your responses have been recorded.' },
  screenout: { icon: XCircle, tone: 'text-ink-3', title: 'Thanks for your time', body: 'This survey is looking for a different profile, so it ends here.' },
  overquota: { icon: Users, tone: 'text-warn', title: 'This group is full', body: 'We already have enough responses from people like you. Thank you for taking part.' },
} as const;

/**
 * Respondent runtime. Talks to the public /r endpoints; the server holds the session state,
 * validates each answer, applies routing and counts quotas atomically on completion.
 */
function Runner() {
  const { surveyId } = useParams<{ surveyId: string }>();
  const qs = useSearchParams();
  const [step, setStep] = useState<Step | null>(null);
  const [value, setValue] = useState<Answer | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const source = qs.get('src') ?? undefined;
    api<Step>(`/r/${surveyId}/start`, { method: 'POST', body: { source, allocation: qs.get('a') ?? undefined, respondent: qs.get('rid') ?? undefined, preview: qs.get('preview') === '1' || undefined } })
      .then((s) => setStep(s))
      .catch((e) => setFatal(e instanceof ApiError ? (e.status === 403 ? 'This survey is not open right now.' : e.status === 404 ? 'We could not find this survey.' : e.message) : 'The survey service is not reachable.'));
  }, [surveyId, qs]);

  const submit = async () => {
    if (!step?.question) return;
    setBusy(true);
    setError(null);
    try {
      const v = step.question.type === 'info' ? '' : step.question.type === 'ranking' && value === undefined ? (step.question.options ?? []).map((o) => o.code) : value;
      const r = await api<Step>(`/r/session/${step.responseId}/answer`, { method: 'POST', body: { questionId: step.question.id, value: v ?? '' } });
      setStep({ ...step, ...r });
      setValue(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your answer. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const end = step?.outcome ? endings[step.outcome] : null;
  // Supplier traffic goes back to the supplier's own page for this outcome (https only, set per allocation).
  const redirect = step?.outcome && step.redirect && step.redirect.startsWith('https://') ? step.redirect : null;
  useEffect(() => {
    if (!redirect) return;
    const t = setTimeout(() => window.location.assign(redirect), 1500);
    return () => clearTimeout(t);
  }, [redirect]);
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-8">
      <div className="flex items-center justify-between"><Logo compact />{step?.preview && <span className="rounded-full bg-orange/15 px-2.5 py-1 text-2xs font-semibold text-orange">Preview: not counted</span>}</div>
      <div className="mt-6 h-1 overflow-hidden rounded-full bg-surface-2"><motion.div className="h-full bg-gradient-to-r from-blue to-cyan" animate={{ width: `${end ? 100 : step?.progress ?? 0}%` }} /></div>
      <div className="flex flex-1 items-center py-8">
        <div className="panel w-full p-6 md:p-8">
          {fatal ? (
            <div className="text-center"><LockKeyhole className="mx-auto text-ink-3" /><p className="mt-3 text-sm">{fatal}</p></div>
          ) : !step ? (
            <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-ink-3" /></div>
          ) : end ? (
            <div className="py-6 text-center"><end.icon size={36} className={`mx-auto ${end.tone}`} /><h1 className="mt-4 font-display text-xl font-semibold">{end.title}</h1><p className="mt-2 text-sm text-ink-2">{end.body}</p>{redirect && <p className="mt-4 text-2xs text-ink-3">Taking you back to your panel… <a className="underline" href={redirect}>Continue</a></p>}</div>
          ) : step.question ? (
            <AnimatePresence mode="wait">
              <motion.div key={step.question.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <h1 className="font-display text-lg font-semibold leading-snug">{step.question.text}</h1>
                {step.question.type === 'multi' && <p className="mt-1 text-2xs text-ink-3">Select all that apply.</p>}
                <div className="mt-5"><QuestionInput q={step.question} seed={step.responseId} value={value} onChange={setValue} /></div>
                {error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
                <Button variant="primary" className="mt-6 w-full" disabled={busy} onClick={submit}>{busy && <Loader2 size={14} className="animate-spin" />}{step.question.type === 'info' ? 'Finish' : 'Next'}</Button>
              </motion.div>
            </AnimatePresence>
          ) : null}
        </div>
      </div>
      <p className="text-center text-2xs text-ink-3">Demo questionnaire. Please do not enter personal or health information.</p>
    </div>
  );
}

export default function RespondentPage() {
  return <Suspense><Runner /></Suspense>;
}

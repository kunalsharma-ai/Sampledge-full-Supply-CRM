'use client';
/**
 * Screen 21 · ZAPX Audience Requests. Requests raised straight from ZAPX surveys, read survey
 * first: a preview of the questionnaire, the four redirects back to SAMPLEON and the QA checks.
 * Launch approval stays locked until every check passes; the lock says which check is failing.
 * "Test redirects" re-runs the four redirect checks against the survey's test link.
 * Integration: ZAPX survey-host adapter and `POST /sampleon/v1/audience-requests` (built in the integration work),
 * redirect test `POST /sampleon/v1/surveys/:id/redirect-test` (planned).
 */
import Link from 'next/link';
import { motion } from 'motion/react';
import { CheckCircle2, CircleDashed, FlaskConical, Link2, Lock, Rocket, Smartphone, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Panel, Segmented } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { CountryChips, KpiTile, ProductChip, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { InfoTip } from '@/components/supply/info-tip';
import { sectionHelp } from '@/lib/supply/help';
import { zapxRequests, type RedirectCheck, type ZapxRequest } from '@/lib/supply/connected';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('zapx-requests')!;
const statusMeta: Record<ZapxRequest['status'], { label: string; tone: 'warn' | 'blue' | 'emerald' | 'cyan' | 'neutral' }> = {
  qa: { label: 'Needs QA', tone: 'warn' }, ready: { label: 'Ready to approve', tone: 'blue' }, approved: { label: 'Approved', tone: 'cyan' }, live: { label: 'Live', tone: 'emerald' }, closed: { label: 'Closed', tone: 'neutral' },
};
const kindLabel: Record<ZapxRequest['questions'][number]['kind'], string> = { single: 'Single choice', multi: 'Multiple choice', grid: 'Grid', open: 'Open text', nps: '0–10 scale' };
const redirectIcon = (s: RedirectCheck['state']) => s === 'passed' ? <CheckCircle2 size={13} className="text-emerald" aria-label="Passed" /> : s === 'failed' ? <XCircle size={13} className="text-danger" aria-label="Failed" /> : <CircleDashed size={13} className="text-ink-3" aria-label="Not tested" />;

export default function ZapxRequests() {
  const toast = useOS((s) => s.toast);
  const [items, setItems] = useState(zapxRequests);
  const [filter, setFilter] = useState<'all' | 'qa' | 'ready' | 'done'>('all');
  const [testing, setTesting] = useState<string | null>(null);
  const [approve, setApprove] = useState<ZapxRequest | null>(null);

  const shown = items.filter((z) => filter === 'all' || (filter === 'done' ? ['approved', 'live', 'closed'].includes(z.status) : z.status === filter));
  const patch = (id: string, f: (z: ZapxRequest) => ZapxRequest) => setItems((l) => l.map((z) => (z.id === id ? f(z) : z)));

  const runTest = (z: ZapxRequest) => {
    setTesting(z.id);
    setTimeout(() => {
      patch(z.id, (x) => {
        const redirects = x.redirects.map((r) => ({ ...r, state: 'passed' as const }));
        const qa = x.qa.map((c) => (c.id === 'redirects' ? { ...c, ok: true, detail: '4 of 4 passed just now' } : c.id === 'test' ? { ...c, ok: true, detail: 'Test link completed just now' } : c));
        const allOk = qa.every((c) => c.ok);
        return { ...x, redirects, qa, status: x.status === 'qa' && allOk ? 'ready' : x.status };
      });
      setTesting(null);
      toast(`Redirects on ${z.surveyId} all return to SampAudience`, 'ok');
    }, 1200);
  };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title={<span className="flex items-center gap-2.5"><ProductChip product="zapx" /> Audience requests</span>}
        subtitle="Requests raised from SampCode surveys, some for a SampTrek project and some for the survey alone. Check the survey and its redirects, then approve the launch." />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Waiting on QA" value={items.filter((z) => z.status === 'qa').length} format="int" good="down" hint="A test run, redirect or LOI check has not passed yet" />
        <KpiTile label="Ready to approve" value={items.filter((z) => z.status === 'ready').length} format="int" hint="All checks passed; launch needs a person" />
        <KpiTile label="Independent surveys" value={items.filter((z) => !z.linkedProject).length} format="int" hint="SampCode surveys with no SampTrek project behind them" />
      </div>

      <Segmented label="Show" size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'qa', label: 'Needs QA' }, { value: 'ready', label: 'Ready' }, { value: 'done', label: 'Approved and live' }]} />

      <div className="grid gap-4 xl:grid-cols-2">
        {shown.map((z) => {
          const failing = z.qa.filter((c) => !c.ok);
          const sm = statusMeta[z.status];
          return (
            <motion.article layout key={z.id} className="panel flex flex-col gap-4 p-4 sm:flex-row" aria-labelledby={`zx-${z.id}`}>
              <div className="w-full shrink-0 sm:w-[190px]" aria-label="Survey preview">
                <div className="rounded-[22px] border-[5px] border-ink-3/25 bg-surface p-2.5 shadow-panel">
                  <div className="mb-2 flex items-center justify-between text-[9.5px] text-ink-3"><Smartphone size={10} aria-hidden /><span>{z.questions.length} questions · {z.plannedLoi} min</span></div>
                  <ol className="space-y-1.5">{z.questions.slice(0, 4).map((q) => <li key={q.n} className="rounded-lg bg-surface-2/60 px-2 py-1.5"><div className="text-[10.5px] font-medium leading-snug">{q.n}. {q.text}</div><div className="text-[9.5px] text-ink-3">{kindLabel[q.kind]}</div></li>)}</ol>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3"><span className="font-mono">{z.surveyId}</span>{z.linkedProject ? <ProductChip product="projexa">{z.linkedProject}</ProductChip> : <Badge tone="neutral">Independent survey</Badge>}<Badge tone={sm.tone} className="ml-auto">{sm.label}</Badge></div>
                <h2 id={`zx-${z.id}`} className="mt-1 flex items-center gap-1 font-display text-[15px] font-semibold">{z.title}<InfoTip entry={sectionHelp('zapx-requests', 'Request card')} label="This request" /></h2>
                <p className="text-2xs text-ink-3">Owner {z.owner} · <CountryChips codes={z.countries} /> · {fmtNum(z.feasibility.estimatedCompletes)} estimated completes{z.feasibility.shortfall ? <span className="text-warn"> (short by {fmtNum(z.feasibility.shortfall)})</span> : ''}</p>

                <ul className="mt-3 space-y-1">{z.qa.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-[12px]">{c.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald" aria-label="Passed" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-danger" aria-label="Failing" />}<span className="min-w-0"><span className={c.ok ? '' : 'font-medium'}>{c.label}</span><span className="block text-2xs text-ink-3">{c.detail}</span></span></li>
                ))}</ul>

                <details className="mt-2 text-[12px]">
                  <summary className="cursor-pointer text-2xs font-medium text-ink-2"><Link2 size={11} className="mr-1 inline" aria-hidden />Redirects ({z.redirects.filter((r) => r.state === 'passed').length} of 4 passed)</summary>
                  <ul className="mt-1.5 space-y-1">{z.redirects.map((r) => <li key={r.kind} className="flex items-center gap-2">{redirectIcon(r.state)}<span className="w-20 capitalize">{r.kind}</span><code className="truncate text-[10.5px] text-ink-3">{r.url}</code></li>)}</ul>
                </details>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(z.status === 'qa' || z.status === 'ready') && <Button size="sm" variant="ghost" disabled={testing === z.id} onClick={() => runTest(z)}><FlaskConical size={13} /> {testing === z.id ? 'Testing…' : 'Test redirects'}</Button>}
                  {(z.status === 'qa' || z.status === 'ready') && (failing.length
                    ? <span className="inline-flex items-center gap-1.5 text-2xs text-ink-3"><Lock size={12} aria-hidden /> Launch locked: {failing[0].label.toLowerCase()}{failing.length > 1 ? ` and ${failing.length - 1} more` : ''}</span>
                    : <Button size="sm" onClick={() => setApprove(z)}><Rocket size={13} /> Approve launch</Button>)}
                  {(z.status === 'approved' || z.status === 'live') && <Link href={`/supply/sampleon?r=${z.requestId}`} className="text-2xs text-primary hover:underline">Open in SampAudience allocation</Link>}
                  {z.status === 'live' && <span className="num ml-auto text-2xs text-ink-3">{fmtNum(z.completes)} completes</span>}
                </div>
              </div>
            </motion.article>
          );
        })}
        {shown.length === 0 && <Panel className="py-12 text-center text-[13px] text-ink-3 xl:col-span-2">Nothing here. Requests appear when a SampCode survey owner asks SampAudience for an audience.</Panel>}
      </div>

      <ConfirmDialog open={!!approve} onOpenChange={(v) => !v && setApprove(null)} tone="primary" title={approve ? `Approve the launch of ${approve.surveyId}?` : ''}
        body={approve ? <>SampAudience moves the request to allocation and schedules a soft launch in {approve.countries.join(', ')}. {approve.linkedProject ? `SampTrek project ${approve.linkedProject} sees it as approved.` : 'The survey owner in SampCode is notified.'}</> : ''}
        confirmLabel="Approve launch" onConfirm={() => { if (approve) { patch(approve.id, (x) => ({ ...x, status: 'approved' })); toast(`${approve.surveyId} approved for launch`, 'ok'); setApprove(null); } }} />
    </div>
  );
}

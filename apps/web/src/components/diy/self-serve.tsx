'use client';
/**
 * Client self-service launch: the client edits the questionnaire of a self-service study, runs QA,
 * accepts the firm price and submits. The research team approves the launch (publishing and the
 * sample purchase together); afterwards the client follows fieldwork per market and can close it.
 * The market screener and per-market quotas are maintained by the server and shown locked here.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Plus, Rocket, Save, ShieldCheck, Square, Trash2, Undo2 } from 'lucide-react';
import type { QType, Question, QaIssue, SurveyDef } from '@/lib/core';
import { api, ApiError } from '@/lib/api';
import { act, shortDate, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { Badge, Bar, Button, EmptyState, Field, inputCls, Panel, PanelHeader, type Tone } from '@/components/ui/primitives';
import { Loadable } from '@/components/ui/data';

export type Study = {
  id: string; title: string; objective: string; audience: string; countries: string[]; sampleSize: number; incidence: number; loi: number; fieldDays: number;
  status: 'draft' | 'submitted' | 'live' | 'rejected' | 'closed'; priceCpi: number | null; priceTotal: number | null; costCpi?: number | null; version: number | null; decisionNote: string | null;
  createdBy: string; createdAt: string; submittedAt: string | null; launchedAt: string | null; closedAt: string | null; surveyId: string; projectId: string;
  survey: { status: string; version: number; questions: number } | null;
  project: { code: string; stage: string; completes: number; target: number; deadline: string } | null;
  markets: { country: string; label: string; target: number; count: number }[];
  approval: { status: string; decidedBy: string | null; decidedAt: string | null } | null;
  links: { respondent: string } | null;
};
type Detail = Study & { definition: SurveyDef };
type Qa = { version: number; issues: QaIssue[]; outcomes: Record<string, number>; estimatedMinutes: number; loi: number; lengthOk: boolean; launchable: boolean };
type Price = { priceCpi: number; priceTotal: number; sampleSize: number; markets: { country: string; n: number; capacityOk: boolean }[]; currency: string };

export const studyStatus: Record<Study['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting for launch approval', tone: 'orange' },
  live: { label: 'In field', tone: 'cyan' },
  rejected: { label: 'Not launched', tone: 'danger' },
  closed: { label: 'Fieldwork closed', tone: 'blue' },
};

const MARKET_Q = 'COUNTRY';
const TYPES: { value: QType; label: string }[] = [
  { value: 'single', label: 'Single choice' }, { value: 'multi', label: 'Multiple choice' }, { value: 'rating', label: 'Rating scale' },
  { value: 'nps', label: 'Likelihood to recommend (0–10)' }, { value: 'numeric', label: 'Number' }, { value: 'text', label: 'Open text' }, { value: 'info', label: 'Information screen' },
];
const hasOptions = (t: QType) => t === 'single' || t === 'multi';
const soRule = (qid: string) => `SO_${qid}`;

/** Codes of a question's options that end the interview as a screen-out. */
function screenouts(def: SurveyDef, qid: string): string[] {
  const r = def.rules.find((x) => x.id === soRule(qid));
  const w = r?.when as { op?: string; values?: string[] } | null | undefined;
  return w?.op === 'in' ? w.values ?? [] : [];
}
function setScreenouts(def: SurveyDef, qid: string, codes: string[]): SurveyDef {
  const rules = def.rules.filter((x) => x.id !== soRule(qid));
  if (codes.length) rules.push({ id: soRule(qid), after: qid, when: { q: qid, op: 'in', values: codes }, action: { terminate: 'screenout' } });
  return { ...def, rules };
}
function nextId(def: SurveyDef) {
  let n = def.questions.length;
  while (def.questions.some((q) => q.id === `Q${n}`)) n++;
  return `Q${n}`;
}

function QuestionEditor({ def, q, index, locked, onChange }: { def: SurveyDef; q: Question; index: number; locked: boolean; onChange: (d: SurveyDef) => void }) {
  const set = (patch: Partial<Question>) => onChange({ ...def, questions: def.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) });
  const so = screenouts(def, q.id);
  const move = (d: -1 | 1) => {
    const qs = [...def.questions];
    const i = qs.findIndex((x) => x.id === q.id), j = i + d;
    if (j < 1 || j >= qs.length) return; // the market screener stays first
    [qs[i], qs[j]] = [qs[j], qs[i]];
    onChange({ ...def, questions: qs });
  };
  const remove = () => onChange({ ...def, questions: def.questions.filter((x) => x.id !== q.id), rules: def.rules.filter((r) => r.after !== q.id) });
  const setType = (t: QType) => {
    const patch: Partial<Question> = { type: t };
    if (hasOptions(t) && !q.options?.length) patch.options = [{ code: '1', label: 'Option 1' }, { code: '2', label: 'Option 2' }];
    if (!hasOptions(t)) patch.options = undefined;
    if (t === 'rating') { patch.min = 1; patch.max = 5; } else if (t === 'nps') { patch.min = 0; patch.max = 10; } else if (t !== 'numeric') { patch.min = undefined; patch.max = undefined; }
    const next = { ...def, questions: def.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) };
    onChange(hasOptions(t) ? next : setScreenouts(next, q.id, []));
  };
  const setOpt = (i: number, label: string) => set({ options: q.options!.map((o, k) => (k === i ? { ...o, label } : o)) });
  const addOpt = () => {
    const used = new Set(q.options!.map((o) => o.code));
    let c = q.options!.length + 1;
    while (used.has(String(c))) c++;
    set({ options: [...q.options!, { code: String(c), label: `Option ${c}` }] });
  };
  const delOpt = (code: string) => onChange(setScreenouts({ ...def, questions: def.questions.map((x) => (x.id === q.id ? { ...x, options: x.options!.filter((o) => o.code !== code) } : x)) }, q.id, so.filter((c) => c !== code)));
  const toggleSo = (code: string) => onChange(setScreenouts(def, q.id, so.includes(code) ? so.filter((c) => c !== code) : [...so, code]));
  const isMarket = q.id === MARKET_Q;

  return (
    <div className="panel-solid space-y-2 p-3" data-testid={`q-${q.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{q.id}</Badge>
        {isMarket ? <Badge tone="blue">Market screener · kept in line with your markets</Badge> : (
          <select className={cn(inputCls, 'h-8 w-auto')} value={q.type} disabled={locked} onChange={(e) => setType(e.target.value as QType)} aria-label={`Type of ${q.id}`}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            {!TYPES.some((t) => t.value === q.type) && <option value={q.type}>{q.type}</option>}
          </select>
        )}
        {!isMarket && q.type !== 'info' && <label className="flex items-center gap-1 text-2xs text-ink-2"><input type="checkbox" checked={q.required !== false} disabled={locked} onChange={(e) => set({ required: e.target.checked })} /> Required</label>}
        {!isMarket && !locked && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" disabled={index <= 1} onClick={() => move(-1)} aria-label={`Move ${q.id} up`}><ArrowUp size={13} /></Button>
            <Button size="sm" variant="ghost" disabled={index >= def.questions.length - 1} onClick={() => move(1)} aria-label={`Move ${q.id} down`}><ArrowDown size={13} /></Button>
            <Button size="sm" variant="ghost" disabled={def.questions.length <= 2} onClick={remove} aria-label={`Delete ${q.id}`}><Trash2 size={13} /></Button>
          </div>
        )}
      </div>
      <textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={q.text} disabled={locked} onChange={(e) => set({ text: e.target.value })} aria-label={`Text of ${q.id}`} />
      {isMarket ? <div className="text-2xs text-ink-3">{q.options?.map((o) => o.label).join(' · ')}. &ldquo;Another country&rdquo; screens out; each market fills its own quota.</div> : hasOptions(q.type) && (
        <div className="space-y-1">
          {q.options?.map((o, i) => (
            <div key={o.code} className="flex items-center gap-2">
              <input className={cn(inputCls, 'h-8')} value={o.label} disabled={locked} onChange={(e) => setOpt(i, e.target.value)} aria-label={`${q.id} option ${o.code}`} />
              <label className="flex shrink-0 items-center gap-1 text-2xs text-ink-2" title="Respondents choosing this leave the survey and are not counted"><input type="checkbox" checked={so.includes(o.code)} disabled={locked} onChange={() => toggleSo(o.code)} aria-label={`${q.id} option ${o.code} screens out`} /> Screens out</label>
              {!locked && <Button size="sm" variant="ghost" disabled={(q.options?.length ?? 0) <= 2} onClick={() => delOpt(o.code)} aria-label={`Remove ${q.id} option ${o.code}`}><Trash2 size={12} /></Button>}
            </div>
          ))}
          {!locked && <Button size="sm" variant="ghost" onClick={addOpt}><Plus size={12} /> Add option</Button>}
        </div>
      )}
      {!isMarket && (q.type === 'rating' || q.type === 'numeric') && (
        <div className="flex gap-2">
          <Field label="Lowest"><input type="number" className={cn(inputCls, 'h-8')} value={q.min ?? 0} disabled={locked} onChange={(e) => set({ min: Number(e.target.value) })} aria-label={`${q.id} lowest`} /></Field>
          <Field label="Highest"><input type="number" className={cn(inputCls, 'h-8')} value={q.max ?? 10} disabled={locked} onChange={(e) => set({ max: Number(e.target.value) })} aria-label={`${q.id} highest`} /></Field>
        </div>
      )}
    </div>
  );
}

function Workspace({ id, onChanged }: { id: string; onChanged: () => void }) {
  const isClient = useOS((s) => s.role === 'client');
  const [tick, setTick] = useState(0);
  const q = useLive<Detail>(`/diy/studies/${id}`, [tick]);
  const reload = () => { setTick((t) => t + 1); onChanged(); };
  return <Loadable q={q}>{(s) => <WorkspaceBody key={`${s.id}:${s.survey?.version}:${s.status}`} s={s} isClient={isClient} reload={reload} />}</Loadable>;
}

function WorkspaceBody({ s, isClient, reload }: { s: Detail; isClient: boolean; reload: () => void }) {
  const editable = isClient && (s.status === 'draft' || s.status === 'rejected');
  const [def, setDef] = useState<SurveyDef>(s.definition);
  const dirty = useMemo(() => JSON.stringify(def) !== JSON.stringify(s.definition), [def, s.definition]);
  const [qa, setQa] = useState<Qa | null>(null);
  const [price, setPrice] = useState<Price | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (editable) void api<Price>(`/diy/studies/${s.id}/price`).then(setPrice).catch(() => setPrice(null)); }, [editable, s.id]);

  const save = async () => {
    setBusy(true);
    const r = await act(() => api(`/diy/studies/${s.id}/questionnaire`, { method: 'PUT', body: { definition: def, label: 'Edited by client', baseVersion: s.survey?.version } }), 'Questionnaire saved as a new version');
    setBusy(false);
    if (r) reload();
  };
  const check = async () => { setBusy(true); const r = await act(() => api<Qa>(`/diy/studies/${s.id}/qa`, { method: 'POST' }), (x) => (x.launchable ? 'Checks passed' : 'Checks found problems to fix')); setBusy(false); if (r) setQa(r); };
  const submit = async () => {
    if (!price) return;
    setBusy(true);
    try {
      await api(`/diy/studies/${s.id}/submit`, { method: 'POST', body: { acceptedTotal: price.priceTotal } });
      useOS.getState().toast('Submitted. The research team reviews it and launches fieldwork.');
      reload();
    } catch (e) {
      // The price moved since it was shown: show the new one and ask again.
      if (e instanceof ApiError && e.status === 409) { const p = await api<Price>(`/diy/studies/${s.id}/price`); setPrice(p); setAccepted(false); }
      useOS.getState().toast(e instanceof ApiError ? e.message : 'Could not reach the API', 'warn');
    } finally { setBusy(false); }
  };
  const post = (path: string, ok: string) => act(() => api(`/diy/studies/${s.id}/${path}`, { method: 'POST' }), ok).then((r) => r && reload());
  const add = () => { const qid = nextId(def); setDef({ ...def, questions: [...def.questions, { id: qid, type: 'single', text: 'New question', required: true, options: [{ code: '1', label: 'Option 1' }, { code: '2', label: 'Option 2' }] }] }); };
  const st = studyStatus[s.status];
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader eyebrow={s.project ? `${s.project.code} · ${s.project.stage}` : 'Self-service study'} title={s.title}
          actions={<Badge tone={st.tone}>{st.label}</Badge>} />
        <div className="grid gap-2 text-[12.5px] text-ink-2 md:grid-cols-4">
          <div>{s.audience} · {s.countries.join(', ')}</div>
          <div>{fmtNum(s.sampleSize)} completes · {s.loi} min</div>
          <div>Incidence {fmtPct(s.incidence, 0)} · {s.fieldDays} days in field</div>
          <div>{s.priceTotal != null ? <>Accepted {fmtMoney(s.priceTotal, false)} · ${s.priceCpi?.toFixed(2)} per complete</> : 'Price set when you submit'}</div>
        </div>
        {s.status === 'rejected' && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">Not launched{s.decisionNote ? `: ${s.decisionNote}` : ''}. Edit the questionnaire and submit again.</p>}
        {s.status === 'submitted' && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-orange/10 px-3 py-2 text-[12.5px] text-orange">
            Submitted {shortDate(s.submittedAt)}. Nothing is published or charged until the research team approves the launch.
            {isClient && <Button size="sm" onClick={() => post('withdraw', 'Submission withdrawn; you can edit again')}><Undo2 size={13} /> Withdraw</Button>}
          </div>
        )}
      </Panel>

      {(s.status === 'live' || s.status === 'closed') && (
        <Panel>
          <PanelHeader eyebrow="Fieldwork" title={`${fmtNum(s.project?.completes ?? 0)} of ${fmtNum(s.sampleSize)} completes`}
            actions={s.status === 'live' && isClient ? <Button size="sm" onClick={() => { if (window.confirm('Close fieldwork? New respondents will be turned away.')) void post('close', 'Fieldwork closed'); }}><Square size={13} /> Close fieldwork</Button> : undefined} />
          <div className="space-y-2">
            {s.markets.map((m) => (
              <div key={m.country} className="text-[12.5px]">
                <div className="mb-1 flex justify-between"><span>{m.label}</span><span className="num text-ink-2">{fmtNum(m.count)} / {fmtNum(m.target)}</span></div>
                <Bar value={m.target ? m.count / m.target : 0} tone={m.count >= m.target ? 'emerald' : 'cyan'} />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-2xs text-ink-3">
            {s.links && <span>Your own respondent link: <code className="text-ink-2">{`${origin}${s.links.respondent}`}</code></span>}
            <Link href="/analytics" className="inline-flex items-center gap-1 text-cyan hover:underline"><ExternalLink size={12} /> Results in Insight Studio</Link>
            <span>Launched {shortDate(s.launchedAt)}{s.closedAt ? ` · closed ${shortDate(s.closedAt)}` : ''}</span>
          </div>
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader eyebrow={`Questionnaire · v${s.survey?.version ?? 1}`} title={editable ? 'Build your questionnaire' : 'Questionnaire'}
            actions={<a href={`/r/${s.surveyId}?preview=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-cyan hover:underline"><ExternalLink size={12} /> Preview saved version</a>} />
          <div className="space-y-2">{def.questions.map((x, i) => <QuestionEditor key={x.id} def={def} q={x} index={i} locked={!editable} onChange={(d) => { setDef(d); setQa(null); }} />)}</div>
          {editable && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={add}><Plus size={13} /> Add question</Button>
              <Button size="sm" variant="primary" disabled={!dirty || busy} onClick={save}><Save size={13} /> Save</Button>
              {dirty && <Button size="sm" variant="ghost" onClick={() => setDef(s.definition)}>Discard changes</Button>}
            </div>
          )}
        </Panel>

        {editable && (
          <div className="space-y-6">
            <Panel>
              <PanelHeader eyebrow="Step 1" title="Check the questionnaire" />
              <Button size="sm" disabled={dirty || busy} onClick={check}><ShieldCheck size={13} /> Run checks</Button>
              {dirty && <span className="ml-2 text-2xs text-ink-3">Save first; checks run on the saved version.</span>}
              {qa && (
                <div className="mt-3 space-y-2 text-[12.5px]">
                  <div className={cn('rounded-lg px-3 py-2', qa.lengthOk ? 'bg-emerald/10 text-emerald' : 'bg-danger/10 text-danger')}>About {qa.estimatedMinutes} min of questions for a {qa.loi}-minute interview{qa.lengthOk ? '' : ': shorten it or raise the interview length above'}</div>
                  {qa.issues.length === 0 ? <div className="flex items-center gap-1.5 text-emerald"><CheckCircle2 size={14} /> No issues in 300 simulated interviews</div> : qa.issues.map((i) => (
                    <div key={i.id} className="panel-solid p-2"><Badge tone={i.severity === 'critical' ? 'danger' : i.severity === 'major' ? 'orange' : 'neutral'}>{i.severity}</Badge> <span className="font-medium">{i.test}</span><div className="text-ink-2">{i.actual}</div><div className="text-2xs text-ink-3">{i.suggestion}</div></div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel>
              <PanelHeader eyebrow="Step 2" title="Accept the price and submit" />
              {!price ? <EmptyState title="Pricing…" /> : (
                <div className="space-y-3 text-[12.5px]">
                  <div className="text-center"><div className="num font-display text-3xl font-semibold">{fmtMoney(price.priceTotal, false)}</div><div className="text-2xs text-ink-3">${price.priceCpi.toFixed(2)} per complete · {fmtNum(price.sampleSize)} completes</div></div>
                  {price.markets.some((m) => !m.capacityOk) && <p className="rounded-lg bg-orange/10 px-3 py-2 text-2xs text-orange">Supply is tight in {price.markets.filter((m) => !m.capacityOk).map((m) => m.country).join(', ')}; the team may extend the field period.</p>}
                  <label className="flex items-start gap-2"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} aria-label="Accept price" /> <span>I accept {fmtMoney(price.priceTotal, false)} for {fmtNum(price.sampleSize)} completes, invoiced at the end of the project for completes delivered.</span></label>
                  <Button variant="primary" disabled={!accepted || dirty || busy || !qa?.launchable} onClick={submit}><Rocket size={14} /> Submit for launch</Button>
                  {!qa?.launchable && <div className="text-2xs text-ink-3">Run the checks and fix any critical issue first.</div>}
                  <div className="text-2xs text-ink-3">The research team approves every launch before the survey goes live or sample is bought.</div>
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

/** List of self-service studies with the selected one's workspace. */
export function SelfServeStudies({ tick, selected, onSelect }: { tick: number; selected: string | null; onSelect: (id: string | null) => void }) {
  const role = useOS((s) => s.role);
  const [own, setOwn] = useState(0);
  const list = useLive<Study[]>('/diy/studies', [tick, own]);
  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader eyebrow="Self-service" title={role === 'client' ? 'Your studies' : 'Client self-service studies'} info={role === 'client' ? undefined : 'Launches arrive as "Launching client studies" approvals for people with purchase approval.'} />
        <Loadable q={list}>{(rows) => !rows.length ? <EmptyState title="No studies yet" body={role === 'client' ? 'Set up the study above and choose Build it myself.' : undefined} /> : (
          <div className="space-y-1.5">{rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onSelect(selected === r.id ? null : r.id)} aria-pressed={selected === r.id}
              className={cn('panel-solid flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-[12.5px]', selected === r.id && 'ring-1 ring-cyan/60')}>
              <span className="min-w-[180px] flex-1 font-medium">{r.title} <span className="text-2xs text-ink-3">{r.project?.code}</span></span>
              <span className="text-ink-2">{r.countries.join(', ')} · n={fmtNum(r.sampleSize)}</span>
              {r.status === 'live' && <span className="num text-ink-2">{fmtNum(r.project?.completes ?? 0)} done</span>}
              {r.priceTotal != null && <span className="num">{fmtMoney(r.priceTotal, false)}</span>}
              {r.costCpi != null && role !== 'client' && <span className="num text-2xs text-ink-3">cost ${r.costCpi.toFixed(2)}</span>}
              <Badge tone={studyStatus[r.status].tone}>{studyStatus[r.status].label}</Badge>
            </button>
          ))}</div>
        )}</Loadable>
      </Panel>
      {selected && <Workspace id={selected} onChanged={() => setOwn((x) => x + 1)} />}
    </div>
  );
}

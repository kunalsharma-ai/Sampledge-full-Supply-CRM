'use client';
import { motion } from 'motion/react';
import { Check, FileUp, Play, Sparkles, Undo2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { runQA, type Condition, type QaIssue, type Question, type QType, type Rule, type SurveyDef } from '@/lib/core';
import { useOS } from '@/lib/store';
import { cn, fmtPct } from '@/lib/utils';
import { can } from '@/lib/core';
import { Badge, Button, EmptyState, inputCls } from '@/components/ui/primitives';

// ───────────────────────── Automated QA
/** Returns a deterministic fix for issues the engine knows how to repair. */
function fixFor(def: SurveyDef, i: QaIssue): { label: string; apply: () => SurveyDef } | null {
  if (i.test === 'Missing answer option') {
    const code = i.expected.match(/"(.+?)"/)?.[1];
    const bad = def.rules.filter((r) => JSON.stringify(r.when).includes(`"${code}"`) && JSON.stringify(r.when).includes(`"${i.questionId}"`));
    if (bad.length) return { label: `Remove rule ${bad.map((r) => r.id).join(', ')}`, apply: () => ({ ...def, rules: def.rules.filter((r) => !bad.includes(r)) }) };
  }
  if (i.test.startsWith('Reachability') && i.questionId) {
    const q = def.questions.find((x) => x.id === i.questionId);
    if (q?.displayIf) return { label: `Remove display logic on ${q.id}`, apply: () => ({ ...def, questions: def.questions.map((x) => (x.id === q.id ? { ...x, displayIf: undefined } : x)) }) };
    return { label: `Delete ${i.questionId}`, apply: () => ({ ...def, questions: def.questions.filter((x) => x.id !== i.questionId) }) };
  }
  if (i.test === 'Exclusive option' && i.questionId) {
    return { label: `Add "None of these" to ${i.questionId}`, apply: () => ({ ...def, questions: def.questions.map((x) => (x.id === i.questionId ? { ...x, options: [...(x.options ?? []), { code: 'none', label: 'None of these', exclusive: true }] } : x)) }) };
  }
  return null;
}

export function QaReport({ def }: { def: SurveyDef }) {
  const update = useOS((s) => s.updateSurvey);
  const canEdit = useOS((s) => can(s.role, 'edit:surveys'));
  const [n, setN] = useState(600);
  const [runId, setRunId] = useState(0);
  const [baseline] = useState(() => runQA(def).issues.length);
  const { issues, sim } = useMemo(() => runQA(def, n), [def, n, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sev = (s: QaIssue['severity']) => (s === 'critical' ? 'danger' : s === 'major' ? 'orange' : 'neutral');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[12.5px]">Simulated respondents
          <select className={cn(inputCls, 'w-24')} value={n} onChange={(e) => setN(+e.target.value)}>{[200, 600, 2000].map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <Button size="sm" variant="primary" onClick={() => setRunId((x) => x + 1)}><Play size={12} /> Re-run QA</Button>
        <span className="text-2xs text-ink-3">Deterministic (seed 7) · definition v{def.version} · {baseline - issues.length > 0 ? `${baseline - issues.length} resolved this session` : 'no fixes applied yet'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Issues', issues.length, issues.some((i) => i.severity === 'critical') ? 'text-danger' : 'text-emerald'], ['Completes', fmtPct(sim.outcomes.complete / sim.n), ''], ['Screen-outs', fmtPct(sim.outcomes.screenout / sim.n), ''], ['Avg path length', sim.avgLength.toFixed(1) + ' Q', ''], ['Reached questions', `${Object.values(sim.visits).filter((v) => v > 0).length}/${def.questions.length}`, '']].map(([l, v, c]) => (
          <div key={l as string} className="panel-solid p-3"><div className="text-2xs text-ink-3">{l}</div><div className={cn('num font-jakarta text-lg font-bold', c as string)}>{v}</div></div>
        ))}
      </div>
      <div>
        <div className="eyebrow mb-2">Question reach across {sim.n} simulated journeys</div>
        <div className="flex h-16 items-end gap-1">
          {def.questions.map((q) => { const v = sim.visits[q.id] / sim.n; return (
            <div key={q.id} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${q.id}: ${fmtPct(v)}`}>
              <motion.div className={cn('w-full shrink-0 rounded-t', v === 0 ? 'bg-danger' : 'bg-gradient-to-t from-blue to-cyan')} initial={{ height: 0 }} animate={{ height: `${Math.max(4, v * 100)}%` }} />
              <span className="mt-1 font-mono text-[9px] text-ink-3">{q.id}</span>
            </div>); })}
        </div>
      </div>
      {!issues.length ? <EmptyState title="All checks passed" body="No routing, option, reachability or translation issues found." icon={<Check size={18} />} /> : (
        <div className="overflow-x-auto rounded-2xl border hairline">
          <table className="w-full min-w-[920px] text-left text-[12px]">
            <thead className="text-2xs uppercase tracking-wider text-ink-3"><tr className="border-b hairline">{['Severity', 'Test case', 'Expected', 'Actual', 'Reproduce', 'Suggested correction', 'Status'].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {issues.map((i) => { const fx = fixFor(def, i); return (
                <tr key={i.id + i.actual} className="border-b hairline align-top last:border-0">
                  <td className="px-3 py-2.5"><Badge tone={sev(i.severity)} dot>{i.severity}</Badge></td>
                  <td className="px-3 py-2.5 font-medium">{i.test}{i.questionId && <div className="font-mono text-2xs text-cyan">{i.questionId}</div>}</td>
                  <td className="px-3 py-2.5 text-ink-2">{i.expected}</td><td className="px-3 py-2.5">{i.actual}</td>
                  <td className="px-3 py-2.5 text-ink-3">{i.repro}</td><td className="px-3 py-2.5 text-ink-2">{i.suggestion}</td>
                  <td className="px-3 py-2.5">{fx ? <Button size="sm" variant="subtle" disabled={!canEdit} onClick={() => update(def.id, fx.apply(), `QA fix: ${fx.label}`)} title={fx.label}><Check size={12} /> Approve fix</Button> : <Badge>Open · manual</Badge>}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── AI programming assistant (rule-based, reviewable diffs)
type Proposal = { summary: string; changes: string[]; next: SurveyDef } | { summary: string; changes: string[]; next: null };

function propose(cmd: string, def: SurveyDef): Proposal {
  const t = cmd.toLowerCase();
  if (/random/.test(t)) {
    const target = def.questions.filter((q) => ['multi', 'single', 'ranking'].includes(q.type) && !q.randomize && (q.options?.length ?? 0) > 3 && !/S\d/.test(q.id));
    const ids = (cmd.match(/\b[QS]\d+\b/g) ?? []).filter((id) => def.questions.some((q) => q.id === id));
    const list = ids.length ? def.questions.filter((q) => ids.includes(q.id)) : target;
    return { summary: `Randomise answer order on ${list.length} question(s). Exclusive options stay anchored last.`, changes: list.map((q) => `${q.id}: randomize = true`), next: { ...def, questions: def.questions.map((q) => (list.includes(q) ? { ...q, randomize: true } : q)) } };
  }
  if (/quota/.test(t) && /(industry|company size|size)/.test(t)) {
    const add: SurveyDef['quotas'] = [];
    if (/industry/.test(t) && !def.quotas.some((c) => c.id.startsWith('ind-'))) ['fin', 'hc', 'tech', 'mfg'].forEach((c) => add.push({ id: `ind-${c}`, label: `Industry: ${def.questions.find((q) => q.id === 'S4')?.options?.find((o) => o.code === c)?.label ?? c}`, when: { q: 'S4', op: 'eq', value: c }, target: 80, count: 0 }));
    if (/size/.test(t) && !def.quotas.some((c) => c.id.startsWith('qt'))) ['xs', 'md', 'lg'].forEach((c) => add.push({ id: `size-${c}`, label: `Size ${c}`, when: { q: 'S2', op: 'eq', value: c }, target: 100, count: 0 }));
    return add.length ? { summary: `Add ${add.length} soft quota cells.`, changes: add.map((c) => `+ quota "${c.label}" target ${c.target}`), next: { ...def, quotas: [...def.quotas, ...add] } } : { summary: 'Matching quotas already exist. No change proposed.', changes: [], next: null };
  }
  if (/translat|german|french|deutsch|français/.test(t)) {
    const langs = [/german|deutsch|\bde\b/.test(t) && 'de', /french|français|\bfr\b/.test(t) && 'fr'].filter(Boolean) as string[];
    const nextLangs = { ...(def.languages ?? {}) };
    const changes: string[] = [];
    langs.forEach((l) => { const dict = { ...(nextLangs[l] ?? {}) }; def.questions.forEach((q) => { if (!dict[q.id]) { dict[q.id] = `[${l.toUpperCase()} draft] ${q.text}`; changes.push(`${l.toUpperCase()} ${q.id}: placeholder added`); } }); nextLangs[l] = dict; });
    return { summary: `Create ${langs.map((l) => l.toUpperCase()).join(' + ')} translation slots. No translation engine is connected in Phase 2, so slots are marked [draft] for a linguist; QA flags them until replaced.`, changes: changes.slice(0, 12).concat(changes.length > 12 ? [`…and ${changes.length - 12} more`] : []), next: { ...def, languages: nextLangs } };
  }
  if (/routing|error|check|qa/.test(t)) {
    const { issues } = runQA(def, 400);
    return { summary: `Ran QA over 400 simulated respondents: ${issues.length} issue(s). Open the QA tab to approve fixes.`, changes: issues.slice(0, 8).map((i) => `${i.severity.toUpperCase()} · ${i.test}: ${i.actual}`), next: null };
  }
  if (/mobile/.test(t)) {
    const mats = def.questions.filter((q) => q.type === 'matrix');
    const qs: Question[] = [];
    def.questions.forEach((q) => { if (q.type === 'matrix') q.rows!.forEach((r, i) => qs.push({ id: `${q.id}_${i + 1}`, block: q.block, type: 'single', text: `${r.label}: ${q.text.replace(/each capability/i, 'this capability')}`, options: q.options, displayIf: q.displayIf })); else qs.push(q); });
    return mats.length ? { summary: `Split ${mats.length} matrix question(s) into single-select cards for small screens.`, changes: mats.flatMap((m) => m.rows!.map((r, i) => `${m.id} → ${m.id}_${i + 1} (${r.label})`)), next: { ...def, questions: qs } } : { summary: 'No matrix grids found; the survey is already mobile-friendly.', changes: [], next: null };
  }
  if (/create|b2b|survey targeting/.test(t)) {
    return { summary: 'Drafting a full survey from a brief needs the AI gateway (Phase 5). In Phase 2, use Import to turn a questionnaire document into a draft, or edit this survey in the Logic builder.', changes: [], next: null };
  }
  return { summary: 'I did not recognise that instruction. Try one of the examples.', changes: [], next: null };
}

export function ProgrammingAssistant({ def }: { def: SurveyDef }) {
  const update = useOS((s) => s.updateSurvey);
  const canEdit = useOS((s) => can(s.role, 'edit:surveys'));
  const undo = useOS((s) => s.undoSurvey);
  const histories = useOS((s) => s.surveyHistory);
  const history = histories[def.id] ?? [];
  const [cmd, setCmd] = useState('');
  const [p, setP] = useState<Proposal | null>(null);
  const examples = ['Randomize these statements', 'Add quota controls by industry and company size', 'Translate this survey into German and French', 'Check the questionnaire for routing errors', 'Generate a mobile-friendly version', 'Create a 15-minute B2B survey targeting IT decision-makers'];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <form onSubmit={(e) => { e.preventDefault(); setP(propose(cmd, def)); }} className="flex gap-2">
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} className={cn(inputCls, 'h-10')} placeholder="Tell the programming assistant what to change…" aria-label="Instruction" />
          <Button variant="primary" type="submit" className="h-10"><Wand2 size={14} /> Propose</Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">{examples.map((x) => <button key={x} onClick={() => { setCmd(x); setP(propose(x, def)); }} className="rounded-full border hairline px-3 py-1 text-2xs text-ink-2 hover:border-cyan/50">{x}</button>)}</div>
        {p && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="panel-solid mt-4 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={14} className="text-cyan" /> Proposed change</div>
            <p className="mt-1 text-[12.5px] text-ink-2">{p.summary}</p>
            {p.changes.length > 0 && <pre className="mt-3 max-h-60 overflow-auto rounded-xl bg-bg/60 p-3 font-mono text-[11px] leading-relaxed text-ink-2">{p.changes.map((c) => (c.startsWith('+') ? c : `~ ${c}`)).join('\n')}</pre>}
            {p.next && <div className="mt-3 flex items-center gap-2"><Button size="sm" variant="primary" disabled={!canEdit} onClick={() => { update(def.id, p.next!, `Assistant: ${cmd || p.summary}`); setP(null); }}><Check size={12} /> Apply (v{def.version + 1})</Button><Button size="sm" variant="ghost" onClick={() => setP(null)}>Discard</Button>{!canEdit && <span className="text-2xs text-orange">Survey Programmer role needed to apply</span>}</div>}
          </motion.div>
        )}
      </div>
      <div className="panel-solid h-fit p-4 text-[12px]">
        <div className="mb-2 flex items-center justify-between"><span className="eyebrow">Version history</span><Button size="sm" variant="ghost" disabled={!history.length} onClick={() => undo(def.id)}><Undo2 size={12} /> Undo</Button></div>
        <div className="num font-semibold">Current: v{def.version}</div>
        <ul className="mt-2 space-y-1 text-ink-3">{[...history].reverse().slice(0, 8).map((h) => <li key={h.version}>v{h.version} · {h.questions.length} questions · {h.rules.length} rules</li>)}</ul>
        {!history.length && <div className="text-ink-3">No edits yet this session.</div>}
        <p className="mt-3 text-2xs text-ink-3">Rule-based assistant. Every change is shown as a diff before it is applied and can be undone.</p>
      </div>
    </div>
  );
}

// ───────────────────────── Questionnaire import
type Parsed = { id: string; text: string; type: QType; options: { code: string; label: string; exclusive?: boolean }[]; notes: string[]; ambiguous: string[]; terminate?: string; displayIf?: string; randomize?: boolean };

export function parseQuestionnaire(src: string): Parsed[] {
  const out: Parsed[] = [];
  let cur: Parsed | null = null;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const qm = line.match(/^([QS]\d+[a-z]?)[.):\s]+(.*)$/i);
    if (qm) {
      cur = { id: qm[1].toUpperCase(), text: qm[2].replace(/\[.*?\]/g, '').trim(), type: 'single', options: [], notes: [], ambiguous: [] };
      out.push(cur);
      const tags = [...qm[2].matchAll(/\[(.*?)\]/g)].map((m) => m[1]);
      tags.forEach((tag) => apply(cur!, tag));
      continue;
    }
    if (!cur) continue;
    const tag = line.match(/^\[(.*)\]$/);
    if (tag) { apply(cur, tag[1]); continue; }
    const om = line.match(/^(?:\d+|[a-z]|-|•)[.)\s]+(.*)$/i);
    if (om) {
      const label = om[1].replace(/\[.*?\]/g, '').trim();
      const exclusive = /none of|don.?t know|prefer not/i.test(label) || /\[exclusive\]/i.test(om[1]);
      const term = /\[(terminate|screen ?out)\]/i.test(om[1]);
      cur.options.push({ code: String(cur.options.length + 1), label, exclusive });
      if (term) cur.terminate = (cur.terminate ? cur.terminate + ',' : '') + String(cur.options.length);
      continue;
    }
    cur.ambiguous.push(`Unrecognised line: “${line.slice(0, 60)}”`);
  }
  out.forEach((q) => {
    if (!q.options.length && q.type === 'single') q.type = /how many|number|percent|%|age/i.test(q.text) ? 'numeric' : 'text';
    if (/select all|all that apply/i.test(q.text)) q.type = 'multi';
    if (/recommend/i.test(q.text) && /0.?10|likely/i.test(q.text)) q.type = 'nps';
    if (q.type === 'single' && q.options.length === 1) q.ambiguous.push('Only one answer option found');
  });
  return out;
  function apply(q: Parsed, tag: string) {
    const t = tag.toLowerCase();
    if (/multi|select all/.test(t)) q.type = 'multi';
    else if (/numeric|number/.test(t)) q.type = 'numeric';
    else if (/open|text/.test(t)) q.type = 'text';
    else if (/grid|matrix/.test(t)) q.type = 'matrix';
    else if (/rank/.test(t)) q.type = 'ranking';
    if (/random|rotate/.test(t)) q.randomize = true;
    const ask = t.match(/ask (?:if|only if)\s+(.*)/);
    if (ask) q.displayIf = ask[1];
    if (/terminate|screen ?out/.test(t)) q.notes.push(`Termination: ${tag}`);
    if (/quota/.test(t)) q.notes.push(`Quota: ${tag}`);
    if (/pipe|insert/.test(t)) q.notes.push(`Piping: ${tag}`);
    if (/programmer|tbd|\?\?|check with client/.test(t)) q.ambiguous.push(`Needs clarification: ${tag}`);
  }
}

const sampleDoc = `S1. What is your age? [NUMERIC] [TERMINATE IF UNDER 18]
S2. Which of these best describes your role?
1. C-level executive
2. IT director or manager
3. IT staff
4. Other [TERMINATE]
Q1. Which cloud services do you use? Select all that apply. [RANDOMIZE]
1. Storage
2. Compute
3. Analytics
4. Security
5. None of these
Q2. Which is your main provider? [ASK IF Q1 = 1 OR 2] [PIPE Q1 ANSWERS]
1. Provider A
2. Provider B
3. Provider C
Q3. How likely are you to recommend your main provider to a colleague (0-10)?
Q4. Anything else? [OPEN] [PROGRAMMER: TBD with client]`;

export function ImportPanel() {
  const update = useOS((s) => s.updateSurvey);
  const toast = useOS((s) => s.toast);
  const [src, setSrc] = useState(sampleDoc);
  const [parsed, setParsed] = useState<Parsed[] | null>(null);
  const onFile = async (f: File) => {
    if (/\.(txt|csv|md)$/i.test(f.name)) setSrc(await f.text());
    else toast(`${f.name}: Word/PDF/Excel extraction arrives in Phase 5. Paste the text for now.`, 'warn');
  };
  const create = () => {
    if (!parsed) return;
    const qs: Question[] = parsed.map((p) => ({ id: p.id, block: 'Imported', type: p.type, text: p.text, options: p.options.length ? p.options : undefined, randomize: p.randomize, ...(p.type === 'numeric' ? { min: 0, max: 120 } : {}), ...(p.type === 'nps' ? { min: 0, max: 10 } : {}) }));
    const rules: Rule[] = parsed.filter((p) => p.terminate).map((p, i) => ({ id: `ri${i}`, after: p.id, when: { q: p.id, op: 'in', values: p.terminate!.split(',') } as Condition, action: { terminate: 'screenout' } }));
    toast(`Draft created with ${qs.length} questions and ${rules.length} termination rules. Status: Draft, not published.`);
    const draft: SurveyDef = { id: 'sv-import', name: 'Imported questionnaire (draft)', version: 0, questions: [...qs, { id: 'END', type: 'info', text: 'Thank you.' }], rules, quotas: [] };
    useOS.setState((s) => ({ surveyDefs: { ...s.surveyDefs, [draft.id]: draft }, surveys: s.surveys.some((x) => x.id === draft.id) ? s.surveys : [{ id: draft.id, name: draft.name, status: 'Draft', questions: qs.length, complexity: 0.3, loi: 8, completionRate: 0, programmer: 'Jonas Weber', hoursSpent: 0, alerts: 0, languages: ['en'], demo: true }, ...s.surveys] }));
    update(draft.id, draft, 'Imported questionnaire');
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="eyebrow">Source questionnaire</span>
          <label className="cursor-pointer"><input type="file" className="hidden" accept=".txt,.csv,.md,.docx,.pdf,.xlsx" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /><span className="inline-flex h-8 items-center gap-1.5 rounded-xl border hairline px-3 text-xs"><FileUp size={13} /> Upload file</span></label>
        </div>
        <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={20} className={cn(inputCls, 'h-auto py-3 font-mono text-[11.5px] leading-relaxed')} aria-label="Questionnaire text" />
        <div className="mt-2 flex items-center gap-2"><Button variant="primary" onClick={() => setParsed(parseQuestionnaire(src))}><Sparkles size={14} /> Extract structure</Button><span className="text-2xs text-ink-3">TXT/CSV parsed now · Word, PDF, Excel planned Phase 5</span></div>
      </div>
      <div>
        <div className="eyebrow mb-2">Review before creating a draft</div>
        {!parsed ? <EmptyState title="Nothing extracted yet" body="Extraction detects question IDs, types, answer options, skip/ask-if instructions, piping, quotas, randomisation and ambiguous notes." /> : (
          <div className="space-y-2">
            {parsed.map((p) => (
              <div key={p.id} className={cn('panel-solid p-3 text-[12px]', p.ambiguous.length && 'ring-1 ring-inset ring-orange/40')}>
                <div className="flex flex-wrap items-center gap-1.5"><Badge tone="blue">{p.id}</Badge><Badge tone="purple">{p.type}</Badge>{p.randomize && <Badge tone="cyan">randomise</Badge>}{p.displayIf && <Badge tone="orange">ask if {p.displayIf}</Badge>}{p.terminate && <Badge tone="danger">terminate opt {p.terminate}</Badge>}</div>
                <div className="mt-1.5 font-medium">{p.text}</div>
                {p.options.length > 0 && <div className="mt-1 text-2xs text-ink-3">{p.options.map((o) => o.label + (o.exclusive ? ' (excl.)' : '')).join(' · ')}</div>}
                {p.notes.map((n) => <div key={n} className="mt-1 text-2xs text-cyan">{n}</div>)}
                {p.ambiguous.map((n) => <div key={n} className="mt-1 text-2xs text-orange">⚠ {n}</div>)}
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2"><Button variant="primary" onClick={create}>Create draft survey</Button><span className="text-2xs text-ink-3">Drafts are never published automatically. Publishing requires approval.</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Schema-driven survey runtime (Phase 2 vertical slice, fully functional, client-side).
 *
 * - Versioned, JSON-serialisable definitions
 * - Deterministic execution: the same definition + answers + seed always yields the same path
 * - Display logic, branching (goto), terminate / screen-out, quotas, option randomisation, piping
 * - Static QA (unreachable questions, dangling references, missing options) + simulated journeys
 *
 * Self-contained on purpose (no imports) so it can move to a shared package for the NestJS
 * runtime in Phase 3 and be unit-tested with plain `node --test`.
 */

export type QType =
  | 'single' | 'multi' | 'dropdown' | 'text' | 'numeric' | 'rating' | 'nps' | 'likert' | 'matrix' | 'ranking'
  | 'slider' | 'constant_sum' | 'maxdiff' | 'info';

export type Option = { code: string; label: string; exclusive?: boolean };

export type Condition =
  | { q: string; op: 'eq' | 'neq'; value: string }
  | { q: string; op: 'in' | 'nin'; values: string[] }
  | { q: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { q: string; op: 'answered' }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type Rule = {
  id: string;
  /** evaluated after `after` is answered, in order; first match wins */
  after: string;
  when: Condition | null; // null = always
  action: { goto: string } | { terminate: 'complete' | 'screenout' | 'overquota' };
};

export type Question = {
  id: string;
  type: QType;
  text: string; // supports piping: {{Q1}} → label of the answer to Q1
  options?: Option[];
  rows?: Option[]; // matrix rows
  min?: number;
  max?: number;
  required?: boolean;
  randomize?: boolean;
  displayIf?: Condition;
  block?: string;
};

export type QuotaCell = { id: string; label: string; when: Condition; target: number; count: number };

export type SurveyDef = {
  id: string;
  name: string;
  version: number;
  questions: Question[];
  rules: Rule[];
  quotas: QuotaCell[];
  languages?: Record<string, Record<string, string>>; // lang → { questionId: text }
};

export type Answer = string | string[] | number | Record<string, string>;
export type Answers = Record<string, Answer>;
export type Outcome = 'complete' | 'screenout' | 'overquota';
export type RunState = { cursor: string | null; answers: Answers; outcome?: Outcome; path: string[] };

// ───────────────────────── Conditions
export function evaluate(c: Condition | null | undefined, a: Answers): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every((x) => evaluate(x, a));
  if ('any' in c) return c.any.some((x) => evaluate(x, a));
  if ('not' in c) return !evaluate(c.not, a);
  const v = a[c.q];
  switch (c.op) {
    case 'answered':
      return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
    case 'eq':
      return Array.isArray(v) ? v.includes(c.value) : String(v) === c.value;
    case 'neq':
      return v === undefined ? true : Array.isArray(v) ? !v.includes(c.value) : String(v) !== c.value;
    case 'in':
      return Array.isArray(v) ? v.some((x) => c.values.includes(x)) : v !== undefined && c.values.includes(String(v));
    case 'nin':
      return Array.isArray(v) ? !v.some((x) => c.values.includes(x)) : v === undefined || !c.values.includes(String(v));
    case 'gt': return typeof v === 'number' && v > c.value;
    case 'gte': return typeof v === 'number' && v >= c.value;
    case 'lt': return typeof v === 'number' && v < c.value;
    case 'lte': return typeof v === 'number' && v <= c.value;
  }
}

export function conditionRefs(c: Condition | null | undefined, out: { q: string; codes: string[] }[] = []) {
  if (!c) return out;
  if ('all' in c) c.all.forEach((x) => conditionRefs(x, out));
  else if ('any' in c) c.any.forEach((x) => conditionRefs(x, out));
  else if ('not' in c) conditionRefs(c.not, out);
  else out.push({ q: c.q, codes: 'value' in c && typeof c.value === 'string' ? [c.value] : 'values' in c ? c.values : [] });
  return out;
}

export function describeCondition(c: Condition | null | undefined, def?: SurveyDef): string {
  if (!c) return 'always';
  if ('all' in c) return c.all.map((x) => describeCondition(x, def)).join(' AND ');
  if ('any' in c) return '(' + c.any.map((x) => describeCondition(x, def)).join(' OR ') + ')';
  if ('not' in c) return `NOT ${describeCondition(c.not, def)}`;
  const q = def?.questions.find((x) => x.id === c.q);
  const lab = (code: string) => q?.options?.find((o) => o.code === code)?.label ?? code;
  switch (c.op) {
    case 'answered': return `${c.q} answered`;
    case 'eq': return `${c.q} = ${lab(c.value)}`;
    case 'neq': return `${c.q} ≠ ${lab(c.value)}`;
    case 'in': return `${c.q} ∈ {${c.values.map(lab).join(', ')}}`;
    case 'nin': return `${c.q} ∉ {${c.values.map(lab).join(', ')}}`;
    default: return `${c.q} ${{ gt: '>', gte: '≥', lt: '<', lte: '≤' }[c.op]} ${c.value}`;
  }
}

// ───────────────────────── Deterministic helpers
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Options in display order. Randomisation is seeded by respondent + question so it is reproducible. */
export function displayOptions(q: Question, respondentSeed: string): Option[] {
  const opts = q.options ?? [];
  if (!q.randomize) return opts;
  const anchored = opts.filter((o) => o.exclusive);
  const free = opts.filter((o) => !o.exclusive);
  const rand = seeded(hash(respondentSeed + ':' + q.id));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return [...free, ...anchored];
}

export function pipe(text: string, def: SurveyDef, a: Answers): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, id: string) => {
    const q = def.questions.find((x) => x.id === id);
    const v = a[id];
    if (v === undefined) return '…';
    if (Array.isArray(v)) return v.map((c) => q?.options?.find((o) => o.code === c)?.label ?? c).join(', ');
    if (typeof v === 'string') return q?.options?.find((o) => o.code === v)?.label ?? v;
    return String(v);
  });
}

// ───────────────────────── Runtime
export function start(def: SurveyDef): RunState {
  return { cursor: firstVisible(def, 0, {}), answers: {}, path: [] };
}

function firstVisible(def: SurveyDef, from: number, a: Answers): string | null {
  for (let i = from; i < def.questions.length; i++) if (evaluate(def.questions[i].displayIf, a)) return def.questions[i].id;
  return null;
}

export function validate(q: Question, v: Answer | undefined): string | null {
  const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (q.type === 'info') return null;
  if (empty) return q.required === false ? null : 'This question requires an answer.';
  if ((q.type === 'numeric' || q.type === 'slider' || q.type === 'rating' || q.type === 'nps') && typeof v === 'number') {
    if (q.min !== undefined && v < q.min) return `Enter a value of at least ${q.min}.`;
    if (q.max !== undefined && v > q.max) return `Enter a value no greater than ${q.max}.`;
  }
  if (q.type === 'multi' && Array.isArray(v) && q.options) {
    const ex = q.options.filter((o) => o.exclusive).map((o) => o.code);
    if (v.length > 1 && v.some((c) => ex.includes(c))) return 'An exclusive option cannot be combined with other answers.';
  }
  if (q.options && (q.type === 'single' || q.type === 'dropdown') && typeof v === 'string' && !q.options.some((o) => o.code === v)) return 'Unknown option.';
  return null;
}

/**
 * Records an answer and advances. Quotas are checked when a respondent would complete
 * (and on any quota whose condition is already fully determined).
 */
export function answer(def: SurveyDef, s: RunState, qid: string, v: Answer): RunState & { error?: string } {
  const q = def.questions.find((x) => x.id === qid);
  if (!q || s.cursor !== qid || s.outcome) return { ...s, error: 'Not the current question.' };
  const err = validate(q, v);
  if (err) return { ...s, error: err };
  const answers = { ...s.answers, [qid]: v };
  const path = [...s.path, qid];

  // Overquota as soon as a full quota cell matches
  for (const cell of def.quotas) {
    const refs = conditionRefs(cell.when).map((r) => r.q);
    if (refs.every((r) => r in answers) && evaluate(cell.when, answers) && cell.count >= cell.target) {
      return { cursor: null, answers, path, outcome: 'overquota' };
    }
  }

  for (const rule of def.rules.filter((r) => r.after === qid)) {
    if (!evaluate(rule.when, answers)) continue;
    if ('terminate' in rule.action) return { cursor: null, answers, path, outcome: rule.action.terminate };
    const idx = def.questions.findIndex((x) => x.id === (rule.action as { goto: string }).goto);
    if (idx >= 0) {
      const next = firstVisible(def, idx, answers);
      return next ? { cursor: next, answers, path } : { cursor: null, answers, path, outcome: 'complete' };
    }
  }
  const idx = def.questions.findIndex((x) => x.id === qid);
  const next = firstVisible(def, idx + 1, answers);
  return next ? { cursor: next, answers, path } : { cursor: null, answers, path, outcome: 'complete' };
}

/** Increments matching quota cells for a completed respondent. Returns a new definition (immutable). */
export function applyQuotas(def: SurveyDef, a: Answers): SurveyDef {
  return { ...def, quotas: def.quotas.map((c) => (evaluate(c.when, a) ? { ...c, count: c.count + 1 } : c)) };
}

// ───────────────────────── QA
export type QaIssue = {
  id: string;
  severity: 'critical' | 'major' | 'minor';
  test: string;
  expected: string;
  actual: string;
  questionId?: string;
  repro: string;
  suggestion: string;
};

/** Random-but-seeded answer generator used by journey simulation. */
export function synthAnswer(q: Question, rand: () => number): Answer {
  const opts = q.options ?? [];
  switch (q.type) {
    case 'single': case 'dropdown': case 'likert':
      return opts.length ? opts[Math.floor(rand() * opts.length)].code : 'x';
    case 'multi': {
      const nonEx = opts.filter((o) => !o.exclusive);
      if (rand() < 0.1 && opts.some((o) => o.exclusive)) return [opts.find((o) => o.exclusive)!.code];
      const sel = nonEx.filter(() => rand() > 0.55).map((o) => o.code);
      return sel.length ? sel : nonEx.length ? [nonEx[0].code] : ['x'];
    }
    case 'numeric': case 'slider': case 'rating': case 'nps': {
      const lo = q.min ?? 0, hi = q.max ?? (q.type === 'nps' ? 10 : 100);
      return Math.round(lo + rand() * (hi - lo));
    }
    case 'matrix':
      return Object.fromEntries((q.rows ?? []).map((r) => [r.code, opts.length ? opts[Math.floor(rand() * opts.length)].code : '1']));
    case 'ranking':
      return [...opts].sort(() => rand() - 0.5).map((o) => o.code);
    case 'info':
      return 'seen';
    default:
      return 'Synthetic response';
  }
}

export function simulate(def: SurveyDef, n = 500, seed = 7) {
  const rand = seeded(seed);
  const visits: Record<string, number> = Object.fromEntries(def.questions.map((q) => [q.id, 0]));
  const outcomes: Record<Outcome, number> = { complete: 0, screenout: 0, overquota: 0 };
  const errors: string[] = [];
  let lengthSum = 0;
  // simulate against a copy whose quota counts start at zero so we test routing, not live fill
  const d = { ...def, quotas: def.quotas.map((c) => ({ ...c, count: 0, target: Number.MAX_SAFE_INTEGER })) };
  for (let i = 0; i < n; i++) {
    let s: RunState & { error?: string } = start(d);
    let guard = 0;
    while (s.cursor && !s.outcome && guard++ < 500) {
      const q = d.questions.find((x) => x.id === s.cursor)!;
      visits[q.id]++;
      const next = answer(d, s, q.id, synthAnswer(q, rand));
      if (next.error) { errors.push(`${q.id}: ${next.error}`); break; }
      s = next;
    }
    if (guard >= 500) errors.push('Infinite loop detected');
    if (s.outcome) outcomes[s.outcome]++;
    lengthSum += s.path.length;
  }
  return { n, visits, outcomes, avgLength: lengthSum / n, errors: [...new Set(errors)] };
}

export function runQA(def: SurveyDef, simulations = 600): { issues: QaIssue[]; sim: ReturnType<typeof simulate> } {
  const issues: QaIssue[] = [];
  const ids = new Set(def.questions.map((q) => q.id));
  const order = Object.fromEntries(def.questions.map((q, i) => [q.id, i]));
  let n = 0;
  const add = (i: Omit<QaIssue, 'id'>) => issues.push({ id: `qa-${++n}`, ...i });

  // 1. Dangling references and missing options
  const allConds: { where: string; c: Condition | null | undefined; qPos: number }[] = [
    ...def.questions.map((q) => ({ where: `${q.id} display logic`, c: q.displayIf, qPos: order[q.id] })),
    ...def.rules.map((r) => ({ where: `rule ${r.id} (after ${r.after})`, c: r.when, qPos: order[r.after] ?? -1 })),
    ...def.quotas.map((c) => ({ where: `quota "${c.label}"`, c: c.when, qPos: Infinity })),
  ];
  for (const { where, c, qPos } of allConds) {
    for (const ref of conditionRefs(c)) {
      const q = def.questions.find((x) => x.id === ref.q);
      if (!q) {
        add({ severity: 'critical', test: 'Reference integrity', expected: `${where} references an existing question`, actual: `References missing question ${ref.q}`, repro: `Open ${where}`, suggestion: `Point the condition at an existing question or remove it.` });
        continue;
      }
      if (order[ref.q] > qPos && qPos !== Infinity) {
        add({ severity: 'major', test: 'Logic order', expected: `${where} depends on earlier answers`, actual: `Depends on ${ref.q}, which is asked later`, questionId: ref.q, repro: `Answer up to ${where}; ${ref.q} has no answer yet`, suggestion: `Move ${ref.q} earlier or change the condition.` });
      }
      for (const code of ref.codes) {
        if (q.options && !q.options.some((o) => o.code === code)) {
          add({ severity: 'critical', test: 'Missing answer option', expected: `Option code "${code}" exists on ${q.id}`, actual: `${q.id} has no option "${code}"`, questionId: q.id, repro: `Inspect ${where}`, suggestion: `Add option "${code}" to ${q.id} or update the condition.` });
        }
      }
    }
  }
  // 2. Goto targets
  for (const r of def.rules) {
    if (!ids.has(r.after)) add({ severity: 'critical', test: 'Routing integrity', expected: `Rule ${r.id} is attached to an existing question`, actual: `Attached to missing ${r.after}`, repro: `Rule ${r.id}`, suggestion: 'Delete or reattach the rule.' });
    if ('goto' in r.action) {
      if (!ids.has(r.action.goto)) add({ severity: 'critical', test: 'Broken redirect', expected: `Goto target ${r.action.goto} exists`, actual: 'Target does not exist', questionId: r.after, repro: `Trigger rule ${r.id}`, suggestion: 'Choose an existing target question.' });
      else if (order[r.action.goto] <= order[r.after]) add({ severity: 'major', test: 'Backward jump', expected: 'Routing moves forward', actual: `${r.after} → ${r.action.goto} jumps backwards (loop risk)`, questionId: r.after, repro: `Trigger rule ${r.id}`, suggestion: 'Use a loop block instead of a backward goto.' });
    }
  }
  // 3. Choice questions without options
  for (const q of def.questions) {
    if (['single', 'multi', 'dropdown', 'likert', 'matrix', 'ranking', 'maxdiff'].includes(q.type) && !(q.options && q.options.length)) {
      add({ severity: 'critical', test: 'Answer options', expected: `${q.id} has answer options`, actual: 'No options defined', questionId: q.id, repro: `Preview ${q.id}`, suggestion: 'Add answer options.' });
    }
    if (q.type === 'multi' && q.options && !q.options.some((o) => o.exclusive) && q.options.length > 3) {
      add({ severity: 'minor', test: 'Exclusive option', expected: `${q.id} offers a "None of these" exclusive option`, actual: 'No exclusive option', questionId: q.id, repro: `Preview ${q.id}`, suggestion: 'Add an exclusive "None of these" option.' });
    }
  }
  // 4. Translation gaps
  for (const [lang, dict] of Object.entries(def.languages ?? {})) {
    const missing = def.questions.filter((q) => !dict[q.id]).map((q) => q.id);
    if (missing.length) add({ severity: 'minor', test: 'Translation coverage', expected: `All questions translated to ${lang.toUpperCase()}`, actual: `${missing.length} missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}`, repro: `Switch preview to ${lang.toUpperCase()}`, suggestion: 'Run translation or provide copy.' });
  }
  // 5. Simulation: unreachable questions + runtime errors
  const sim = simulate(def, simulations);
  for (const q of def.questions) {
    if (sim.visits[q.id] === 0) add({ severity: 'major', test: 'Reachability (simulated journeys)', expected: `${q.id} reached by at least one of ${simulations} simulated respondents`, actual: 'Never reached', questionId: q.id, repro: `Simulate ${simulations} journeys (seed 7)`, suggestion: 'Check display logic and the routing rules that skip it.' });
  }
  for (const e of sim.errors) add({ severity: 'critical', test: 'Runtime validation', expected: 'Synthetic answers validate', actual: e, repro: 'Simulated journeys', suggestion: 'Fix the question configuration.' });
  if (sim.outcomes.complete === 0) add({ severity: 'critical', test: 'Completion path', expected: 'At least one path completes', actual: 'No simulated respondent completed', repro: 'Simulated journeys', suggestion: 'Review termination rules.' });

  const rank = { critical: 0, major: 1, minor: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { issues, sim };
}

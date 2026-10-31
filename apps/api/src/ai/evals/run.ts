/**
 * Runs the AI evaluation set and reports a scorecard.
 *
 *   node dist/ai/evals/run.js                       rule-based implementations (free, no data leaves)
 *   node dist/ai/evals/run.js --provider anthropic  the connected model (needs ANTHROPIC_API_KEY; costs money)
 *   options: --task rfq.extract  --out report.json  --md report.md
 *
 * Model runs call the task prompts directly (no database, no fallback), so a model failure shows up
 * as a failed case instead of being hidden behind the rule-based answer.
 */
import { writeFileSync } from 'node:fs';
import { AiGateway, type AiTask } from '../gateway';
import { openEndCodeframe, projectSummary, questionnaireStructure, rfqExtract } from '../tasks';
import { codeframeCases, questionnaireCases, rfqCases, summaryCases, type Check, type EvalCase } from './cases';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCase = EvalCase<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const suites: { task: AiTask<any, any>; cases: AnyCase[] }[] = [
  { task: rfqExtract, cases: rfqCases },
  { task: questionnaireStructure, cases: questionnaireCases },
  { task: projectSummary, cases: summaryCases },
  { task: openEndCodeframe, cases: codeframeCases },
];

export type CaseResult = { id: string; title: string; pass: boolean; criticalFailed: number; checks: Check[]; status: string; costUsd: number; ms: number };
export type EvalReport = {
  provider: 'rules' | 'anthropic'; model: string | null; at: string;
  tasks: { task: string; version: number; cases: number; passed: number; checks: number; checksPassed: number; criticalFailed: number; costUsd: number; results: CaseResult[] }[];
  totals: { cases: number; passed: number; checks: number; checksPassed: number; criticalFailed: number; costUsd: number };
};

export async function runEvals(provider: 'rules' | 'anthropic', only?: string): Promise<EvalReport> {
  const gw = provider === 'anthropic' ? new AiGateway(null as never) : null;
  let model: string | null = null;
  const tasks: EvalReport['tasks'] = [];
  for (const { task, cases } of suites) {
    if (only && task.name !== only) continue;
    const results: CaseResult[] = [];
    for (const c of cases) {
      const t0 = Date.now();
      let checks: Check[], status = 'ok', costUsd = 0;
      if (gw) {
        const g = await gw.generate(task, c.input);
        costUsd = g.costUsd;
        model ??= g.model;
        if (g.kind === 'ok') checks = c.grade(g.data, c.input);
        else { status = g.kind; checks = [{ name: `model returned a usable answer`, pass: false, critical: true, detail: `${g.kind}: ${g.error}` }]; }
      } else checks = c.grade(task.rules(c.input), c.input);
      const criticalFailed = checks.filter((x) => x.critical && !x.pass).length;
      results.push({ id: c.id, title: c.title, pass: checks.every((x) => x.pass), criticalFailed, checks, status, costUsd, ms: Date.now() - t0 });
    }
    const sum = (f: (r: CaseResult) => number) => results.reduce((s, r) => s + f(r), 0);
    tasks.push({ task: task.name, version: task.version, cases: results.length, passed: results.filter((r) => r.pass).length, checks: sum((r) => r.checks.length), checksPassed: sum((r) => r.checks.filter((x) => x.pass).length), criticalFailed: sum((r) => r.criticalFailed), costUsd: sum((r) => r.costUsd), results });
  }
  const tot = (k: 'cases' | 'passed' | 'checks' | 'checksPassed' | 'criticalFailed' | 'costUsd') => tasks.reduce((s, t) => s + t[k], 0);
  return { provider, model, at: new Date().toISOString(), tasks, totals: { cases: tot('cases'), passed: tot('passed'), checks: tot('checks'), checksPassed: tot('checksPassed'), criticalFailed: tot('criticalFailed'), costUsd: tot('costUsd') } };
}

export function toMarkdown(r: EvalReport) {
  const pc = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
  const lines = [
    `# AI evaluation: ${r.provider === 'rules' ? 'rule-based implementations' : r.model ?? 'model'}`,
    '', `Run ${r.at}. Synthetic test inputs only.`, '',
    '| Task | Cases passed | Checks passed | Critical failures | Cost |', '|---|---|---|---|---|',
    ...r.tasks.map((t) => `| ${t.task} v${t.version} | ${t.passed}/${t.cases} | ${t.checksPassed}/${t.checks} (${pc(t.checksPassed, t.checks)}) | ${t.criticalFailed} | $${t.costUsd.toFixed(3)} |`),
    `| **Total** | **${r.totals.passed}/${r.totals.cases}** | **${r.totals.checksPassed}/${r.totals.checks} (${pc(r.totals.checksPassed, r.totals.checks)})** | **${r.totals.criticalFailed}** | **$${r.totals.costUsd.toFixed(3)}** |`,
    '', '## Failed checks', '',
  ];
  for (const t of r.tasks) for (const c of t.results) for (const x of c.checks.filter((k) => !k.pass)) lines.push(`- ${c.id} (${c.title}): ${x.critical ? '**critical** ' : ''}${x.name}${x.detail ? `: ${x.detail}` : ''}`);
  if (!r.tasks.some((t) => t.results.some((c) => !c.pass))) lines.push('None.');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const provider = arg('provider') === 'anthropic' ? 'anthropic' : 'rules';
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) { console.error('--provider anthropic needs ANTHROPIC_API_KEY'); process.exit(2); }
  runEvals(provider, arg('task')).then((r) => {
    const md = toMarkdown(r);
    console.log(md);
    if (arg('out')) writeFileSync(arg('out')!, JSON.stringify(r, null, 2));
    if (arg('md')) writeFileSync(arg('md')!, md);
    process.exit(r.totals.criticalFailed ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}

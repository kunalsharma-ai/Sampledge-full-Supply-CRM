'use client';
/**
 * Methods lab: the research-method engines in @sampledge/core run on simulated respondents so a
 * researcher can see what each design and analysis produces before fielding. Every number here is
 * computed live in the browser from the simulated answers; none of it is client data.
 */
import { useMemo, useState } from 'react';
import { conjointDesign, conjointEstimate, conjointSimulate, gaborGranger, maxDiffDesign, maxDiffScores, maxDiffSetsNeeded, turf, vanWestendorp, type Attribute, type ConjointChoice, type MaxDiffAnswer, type VwAnswer } from '@/lib/core';
import { EChart, axis } from '@/components/charts/echart';
import { fmtNum, fmtPct } from '@/lib/utils';
import { Badge, Bar, DemoBadge, Field, inputCls, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';

type Method = 'maxdiff' | 'conjoint' | 'vw' | 'gg' | 'turf';

function rng(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const gumbel = (r: () => number) => -Math.log(-Math.log(Math.max(1e-9, r())));
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-2xs leading-relaxed text-ink-3">{children}</p>;
}
function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  return <div className="w-36"><Field label={label}><input type="number" className={inputCls} value={value} min={min} max={max} step={step} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }} aria-label={label} /></Field></div>;
}

// ───────────────────────── MaxDiff

const MD_ITEMS = ['Lower monthly price', 'Faster support response', 'Single sign-on', 'Data residency in region', 'Usage-based billing', 'Built-in analytics', 'Mobile app', 'Open API', 'Dedicated account manager', 'Carbon-neutral hosting'];

function MaxDiffLab() {
  const [perSet, setPerSet] = useState(4);
  const [n, setN] = useState(200);
  const sets = maxDiffSetsNeeded(MD_ITEMS.length, perSet);
  const out = useMemo(() => {
    const design = maxDiffDesign({ items: MD_ITEMS.length, perSet, sets, versions: 4, seed: 7 });
    const r = rng(11);
    const truth = MD_ITEMS.map((_, i) => 1.6 - i * 0.32);
    const answers: MaxDiffAnswer[] = [];
    for (let p = 0; p < n; p++) {
      const version = design.versions[p % design.versions.length];
      for (const set of version) {
        const u = set.map((i) => truth[i] + gumbel(r));
        answers.push({ set, best: set[u.indexOf(Math.max(...u))], worst: set[u.indexOf(Math.min(...u))] });
      }
    }
    return { design, scores: maxDiffScores(MD_ITEMS, answers) };
  }, [perSet, n, sets]);
  const d = out.design.diagnostics;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel>
        <PanelHeader eyebrow="Design" title={`${MD_ITEMS.length} items, ${perSet} per set, ${sets} sets × 4 versions`} />
        <div className="flex flex-wrap gap-3"><NumberField label="Items per set" value={perSet} onChange={setPerSet} min={3} max={6} /><NumberField label="Respondents" value={n} onChange={setN} min={20} max={2000} step={20} /></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px]">
          <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Times each item shown</div><div className="num font-semibold">{d.appearancesMin}–{d.appearancesMax}</div></div>
          <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Pair co-occurrence</div><div className="num font-semibold">{d.pairMin}–{d.pairMax}</div></div>
          <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Position deviation</div><div className="num font-semibold">{d.positionMaxDeviation}</div></div>
        </div>
        <div className="mt-4 space-y-1 text-[12px]">{out.design.versions[0].slice(0, 4).map((s, i) => <div key={i} className="rounded-lg bg-surface-2/40 px-2 py-1"><span className="text-ink-3">Set {i + 1}: </span>{s.map((x) => MD_ITEMS[x]).join(' · ')}</div>)}</div>
        <Note>Sets per version follow the usual rule of each item appearing about three times. The generator balances item frequency, pair co-occurrence and on-screen position.</Note>
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Analysis (counts)" title="Preference scores" actions={<DemoBadge label="Simulated respondents" />} />
        <div className="space-y-2">{out.scores.map((s) => (
          <div key={s.item} className="grid grid-cols-[minmax(0,1fr)_140px_44px] items-center gap-3 text-[12.5px]"><span className="truncate">{s.item}</span><Bar value={s.index / 100} /><span className="num text-right">{fmtNum(s.index, 0)}</span></div>
        ))}</div>
        <Note>Score = (times best − times worst) ÷ times shown, rescaled 0–100. Simulated answers come from a fixed preference order plus random noise, so the recovered order should match the list. Hierarchical Bayes individual scores are not implemented.</Note>
      </Panel>
    </div>
  );
}

// ───────────────────────── Conjoint

const CJ_ATTRS: Attribute[] = [
  { name: 'Price per month', levels: ['$19', '$29', '$39', '$49'] },
  { name: 'Contract', levels: ['Monthly', 'Annual'] },
  { name: 'Support', levels: ['Email', 'Chat', 'Phone 24/7'] },
  { name: 'Storage', levels: ['50 GB', '200 GB', 'Unlimited'] },
];
const CJ_TRUTH = [[0.9, 0.4, -0.3, -1.0], [0.3, -0.3], [-0.5, 0.1, 0.4], [-0.6, 0.1, 0.5]];

function ConjointLab() {
  const [n, setN] = useState(300);
  const [a, setA] = useState<Record<string, string>>({ 'Price per month': '$29', Contract: 'Monthly', Support: 'Chat', Storage: '200 GB' });
  const [b, setB] = useState<Record<string, string>>({ 'Price per month': '$39', Contract: 'Annual', Support: 'Phone 24/7', Storage: 'Unlimited' });
  const est = useMemo(() => {
    const design = conjointDesign({ attributes: CJ_ATTRS, tasks: 10, alternatives: 3, versions: 10, seed: 3 });
    const r = rng(5);
    const choices: ConjointChoice[] = [];
    for (let p = 0; p < n; p++) for (const task of design.versions[p % design.versions.length]) {
      const u = task.alternatives.map((alt) => alt.reduce((s, l, k) => s + CJ_TRUTH[k][l], 0) + gumbel(r));
      choices.push({ task, chosen: u.indexOf(Math.max(...u)) });
    }
    return { design, est: conjointEstimate(CJ_ATTRS, choices) };
  }, [n]);
  const shares = conjointSimulate(est.est, [a, b]);
  const Product = ({ label, v, set }: { label: string; v: Record<string, string>; set: (x: Record<string, string>) => void }) => (
    <div className="panel-solid space-y-2 p-3"><div className="text-[12px] font-medium">{label}</div>
      {CJ_ATTRS.map((at) => <select key={at.name} className={inputCls} aria-label={`${label} ${at.name}`} value={v[at.name]} onChange={(e) => set({ ...v, [at.name]: e.target.value })}>{at.levels.map((l) => <option key={l}>{l}</option>)}</select>)}
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader eyebrow="Estimation (aggregate logit)" title="Part-worth utilities and importance" actions={<DemoBadge label="Simulated respondents" />} />
        <NumberField label="Respondents" value={n} onChange={setN} min={50} max={1000} step={50} />
        <div className="mt-4 space-y-4">{est.est.partWorths.map((pw) => {
          const imp = est.est.importance.find((i) => i.attribute === pw.attribute)!.importance;
          return (
            <div key={pw.attribute}><div className="mb-1 flex justify-between text-[12px]"><span className="font-medium">{pw.attribute}</span><span className="text-ink-3">importance <span className="num">{fmtPct(imp, 0)}</span></span></div>
              <div className="grid grid-cols-4 gap-1.5">{pw.levels.map((l) => <div key={l.level} className="rounded-lg bg-surface-2/40 px-2 py-1 text-[11.5px]"><div className="text-ink-3">{l.level}</div><div className={`num font-semibold ${l.utility >= 0 ? 'text-emerald' : 'text-danger'}`}>{l.utility > 0 ? '+' : ''}{l.utility.toFixed(2)}</div></div>)}</div>
            </div>
          );
        })}</div>
        <Note>{fmtNum(est.est.fit.choices)} choices · McFadden R² {est.est.fit.mcFaddenR2} · design level balance {fmtPct(est.design.levelBalance, 0)}. Effects coding, so utilities sum to zero within each attribute. A single aggregate model: no individual-level (HB) estimates.</Note>
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Market simulator" title="Share of preference" info="Logit rule over the estimated utilities. Shares describe stated preference among these options only, not market share." />
        <div className="grid grid-cols-2 gap-3"><Product label="Product A" v={a} set={setA} /><Product label="Product B" v={b} set={setB} /></div>
        <div className="mt-4 space-y-2">{[['Product A', shares[0]], ['Product B', shares[1]]].map(([l, s]) => <div key={l as string} className="grid grid-cols-[90px_1fr_48px] items-center gap-3 text-[12.5px]"><span>{l}</span><Bar value={s as number} tone="cyan" /><span className="num text-right">{fmtPct(s as number, 0)}</span></div>)}</div>
      </Panel>
    </div>
  );
}

// ───────────────────────── Van Westendorp and Gabor-Granger

function VwLab() {
  const [n, setN] = useState(250);
  const res = useMemo(() => {
    const r = rng(9);
    const answers: VwAnswer[] = Array.from({ length: n }, () => {
      const c = Math.max(4, 22 + normal(r) * 5);
      const tc = c * (0.55 + r() * 0.15), ex = c * (1.3 + r() * 0.2), te = ex * (1.25 + r() * 0.2);
      return { tooCheap: Math.round(tc), cheap: Math.round(c), expensive: Math.round(ex), tooExpensive: Math.round(te) };
    });
    answers.push({ tooCheap: 30, cheap: 20, expensive: 40, tooExpensive: 50 }); // inconsistent on purpose: excluded
    return vanWestendorp(answers, 120);
  }, [n]);
  const p = res.points;
  const pts: [string, number | null][] = [['Point of marginal cheapness', p.pointOfMarginalCheapness], ['Optimal price point', p.optimalPricePoint], ['Indifference price point', p.indifferencePricePoint], ['Point of marginal expensiveness', p.pointOfMarginalExpensiveness]];
  return (
    <Panel>
      <PanelHeader eyebrow="Price sensitivity meter" title="Van Westendorp" actions={<DemoBadge label="Simulated respondents" />} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <EChart ariaLabel="Van Westendorp curves" height={300} deps={[res]} option={(t) => ({
          tooltip: { trigger: 'axis', valueFormatter: (v) => fmtPct(Number(v), 0) }, legend: { top: 0 }, grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
          xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `$${v}` } },
          yAxis: { type: 'value', max: 1, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
          series: (['tooCheap', 'cheap', 'expensive', 'tooExpensive'] as const).map((k, i) => ({ type: 'line', name: ['Too cheap', 'Cheap', 'Expensive', 'Too expensive'][i], showSymbol: false, smooth: false, data: res.curves.map((c) => [c.price, c[k]]), lineStyle: { width: 2, type: i === 1 || i === 2 ? 'dashed' : 'solid' } })),
        })} />
        <div className="space-y-2">
          <NumberField label="Respondents" value={n} onChange={setN} min={30} max={2000} step={10} />
          {pts.map(([l, v]) => <div key={l} className="panel-solid flex justify-between px-3 py-2 text-[12.5px]"><span>{l}</span><span className="num font-semibold">{v == null ? 'none' : `$${v.toFixed(2)}`}</span></div>)}
          <p className="text-2xs text-ink-3">{res.n} consistent answers used, {res.excluded} excluded for answering out of order.</p>
        </div>
      </div>
    </Panel>
  );
}

const GG_PRICES = [15, 20, 25, 30, 35, 40];
function GgLab() {
  const res = useMemo(() => {
    const r = rng(21);
    const answers = Array.from({ length: 300 }, () => { const wtp = 18 + r() * 24 + normal(r) * 3; return Object.fromEntries(GG_PRICES.map((p) => [p, p <= wtp])) as Record<number, boolean>; });
    return gaborGranger(GG_PRICES, answers);
  }, []);
  return (
    <Panel>
      <PanelHeader eyebrow="Demand curve" title="Gabor-Granger" actions={<DemoBadge label="Simulated respondents" />} />
      <EChart ariaLabel="Gabor-Granger demand and revenue" height={260} deps={[res]} option={(t) => ({
        tooltip: { trigger: 'axis' }, legend: { top: 0 }, grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
        xAxis: { type: 'category', data: res.curve.map((c) => `$${c.price}`), ...axis(t), splitLine: { show: false } },
        yAxis: [{ type: 'value', max: 1, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } }, { type: 'value', ...axis(t), splitLine: { show: false } }],
        series: [
          { type: 'bar', name: 'Would buy', data: res.curve.map((c) => c.demand), itemStyle: { borderRadius: [4, 4, 0, 0] } },
          { type: 'line', name: 'Revenue index', yAxisIndex: 1, data: res.curve.map((c) => c.revenueIndex) },
        ],
      })} />
      <div className="mt-2 flex flex-wrap gap-1.5"><Badge tone="blue">Revenue-maximising price ${res.revenueMaximisingPrice}</Badge>{res.elasticity.map((e) => <Badge key={e.from}>${e.from}→${e.to}: elasticity {e.elasticity}</Badge>)}</div>
      <Note>Revenue index = price × share who would buy. It ignores cost and competitor response, so treat it as an input to pricing, not the answer.</Note>
    </Panel>
  );
}

// ───────────────────────── TURF

const TURF_ITEMS = ['Original', 'Sea salt', 'Barbecue', 'Sour cream', 'Chilli lime', 'Salt & vinegar', 'Cheddar', 'Jalapeño', 'Truffle', 'Honey mustard', 'Paprika', 'Black pepper'];
function TurfLab() {
  const [k, setK] = useState(4);
  const res = useMemo(() => {
    const r = rng(33);
    const appeal = TURF_ITEMS.map((_, i) => 0.42 - i * 0.025);
    const reach = Array.from({ length: 400 }, () => { const taste = r(); return TURF_ITEMS.map((_, i) => r() < appeal[i] * (i % 3 === Math.floor(taste * 3) ? 1.6 : 0.6)); });
    return turf(TURF_ITEMS, reach, k);
  }, [k]);
  return (
    <Panel>
      <PanelHeader eyebrow="Portfolio reach" title="TURF" actions={<DemoBadge label="Simulated respondents" />} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">
          <NumberField label="Portfolio size" value={k} onChange={setK} min={1} max={8} />
          <div className="panel-solid p-3 text-center"><div className="text-2xs text-ink-3">Unduplicated reach</div><div className="num font-display text-3xl font-semibold text-blue">{fmtPct(res.reach, 0)}</div><div className="text-2xs text-ink-3">avg {res.frequency.toFixed(2)} items liked per person</div></div>
          <p className="text-2xs text-ink-3">Search: {res.method === 'exhaustive' ? 'every combination checked' : 'greedy (too many combinations to check all)'}.</p>
        </div>
        <div className="space-y-2">{res.ladder.map((l, i) => (
          <div key={l.item} className="grid grid-cols-[22px_minmax(0,1fr)_160px_90px] items-center gap-3 text-[12.5px]"><span className="num text-ink-3">{i + 1}</span><span>{l.item}</span><Bar value={l.reach} tone="emerald" /><span className="num text-right">{fmtPct(l.reach, 0)} <span className="text-ink-3">+{fmtPct(l.increment, 0)}</span></span></div>
        ))}</div>
      </div>
      <Note>Reach is the share of simulated respondents who would choose at least one item in the line-up. The ladder adds items in order of incremental reach.</Note>
    </Panel>
  );
}

export function MethodsLab() {
  const [m, setM] = useState<Method>('maxdiff');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Method" value={m} onChange={setM} options={[{ value: 'maxdiff', label: 'MaxDiff' }, { value: 'conjoint', label: 'Conjoint' }, { value: 'vw', label: 'Van Westendorp' }, { value: 'gg', label: 'Gabor-Granger' }, { value: 'turf', label: 'TURF' }]} />
        <span className="text-2xs text-ink-3">All results on this tab come from simulated respondents, computed in your browser by the same engine the platform uses on real data.</span>
      </div>
      {m === 'maxdiff' && <MaxDiffLab />}
      {m === 'conjoint' && <ConjointLab />}
      {m === 'vw' && <VwLab />}
      {m === 'gg' && <GgLab />}
      {m === 'turf' && <TurfLab />}
    </div>
  );
}

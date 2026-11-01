'use client';
/**
 * Advanced methods.
 *  - Van Westendorp, Gabor-Granger and TURF run on a survey's fielded interviews: the analyst maps
 *    the survey's questions to the method's inputs and the API computes the result from completed,
 *    non-rejected responses.
 *  - MaxDiff and choice-based conjoint: generate a balanced design for your own items or attributes,
 *    download it for fielding, then upload the fielded answers (CSV) to score them. Answers are
 *    analysed in the browser with the platform's engine and are not stored.
 */
import { useMemo, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { conjointDesign, conjointEstimate, conjointSimulate, gaborGranger, maxDiffDesign, maxDiffScores, maxDiffSetsNeeded, turf, vanWestendorp, type Attribute, type ConjointChoice, type MaxDiffAnswer } from '@/lib/core';
import { api, ApiError } from '@/lib/api';
import { useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { EChart, axis } from '@/components/charts/echart';
import { fmtNum, fmtPct } from '@/lib/utils';
import { Badge, Bar, Button, EmptyState, Field, inputCls, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';

type Method = 'maxdiff' | 'conjoint' | 'vw' | 'gg' | 'turf';

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-2xs leading-relaxed text-ink-3">{children}</p>;
}
function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  return <div className="w-36"><Field label={label}><input type="number" className={inputCls} value={value} min={min} max={max} step={step} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }} aria-label={label} /></Field></div>;
}

/** Minimal CSV: header row, comma separated, double quotes for fields containing commas or quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; } else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function download(name: string, lines: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
function CsvUpload({ label, onRows }: { label: string; onRows: (rows: Record<string, string>[]) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border hairline px-3 py-1.5 text-[12px] hover:border-blue/50">
      <Upload size={12} /> {label}
      <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onRows(parseCsv(await f.text())); e.target.value = ''; }} />
    </label>
  );
}
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

// ───────────────────────── MaxDiff

function MaxDiffLab() {
  const [itemsText, setItemsText] = useState('Lower monthly price\nFaster support response\nSingle sign-on\nData residency in region\nUsage-based billing\nBuilt-in analytics\nMobile app\nOpen API');
  const [perSet, setPerSet] = useState(4);
  const [versions, setVersions] = useState(4);
  const [answers, setAnswers] = useState<MaxDiffAnswer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const items = lines(itemsText);
  const design = useMemo(() => { try { return { d: maxDiffDesign({ items: items.length, perSet, versions, seed: 7 }), e: null }; } catch (e) { return { d: null, e: (e as Error).message }; } }, [itemsText, perSet, versions]); // eslint-disable-line react-hooks/exhaustive-deps
  const scores = useMemo(() => (answers?.length ? maxDiffScores(items, answers) : null), [answers]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportDesign = () => design.d && download('maxdiff-design.csv', [['version', 'set', 'position', 'item'], ...design.d.versions.flatMap((v, vi) => v.flatMap((set, si) => set.map((it, pi) => [vi + 1, si + 1, pi + 1, items[it]])))]);
  const load = (rows: Record<string, string>[]) => {
    setErr(null);
    if (!design.d) return;
    const out: MaxDiffAnswer[] = [];
    for (const [i, r] of rows.entries()) {
      const set = design.d.versions[Number(r.version) - 1]?.[Number(r.set) - 1];
      const best = items.indexOf(r.best), worst = items.indexOf(r.worst);
      if (!set || best < 0 || worst < 0 || !set.includes(best) || !set.includes(worst) || best === worst) { setErr(`Row ${i + 2}: needs version, set, best and worst matching the design (best and worst are item names from that set)`); return; }
      out.push({ set, best, worst });
    }
    if (!out.length) { setErr('No answer rows found'); return; }
    setAnswers(out);
  };
  const d = design.d?.diagnostics;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel>
        <PanelHeader eyebrow="Design" title={design.d ? `${items.length} items, ${perSet} per set, ${maxDiffSetsNeeded(items.length, perSet)} sets × ${versions} versions` : 'MaxDiff design'} />
        <Field label="Items (one per line)"><textarea className={`${inputCls} h-32 py-2`} value={itemsText} onChange={(e) => { setItemsText(e.target.value); setAnswers(null); }} /></Field>
        <div className="mt-3 flex flex-wrap gap-3"><NumberField label="Items per set" value={perSet} onChange={(n) => { setPerSet(n); setAnswers(null); }} min={2} max={6} /><NumberField label="Versions" value={versions} onChange={(n) => { setVersions(n); setAnswers(null); }} min={1} max={20} /></div>
        {design.e ? <p className="mt-3 text-2xs text-danger">{design.e}</p> : d && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px]">
              <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Times each item shown</div><div className="num font-semibold">{d.appearancesMin}–{d.appearancesMax}</div></div>
              <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Pair co-occurrence</div><div className="num font-semibold">{d.pairMin}–{d.pairMax}</div></div>
              <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Position deviation</div><div className="num font-semibold">{d.positionMaxDeviation}</div></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={exportDesign}><Download size={12} /> Download design CSV</Button><CsvUpload label="Upload answers CSV" onRows={load} /></div>
          </>
        )}
        <Note>Field the downloaded design (one version per respondent), then upload the answers as CSV with columns version, set, best, worst (best and worst as item names). Changing the items or design clears loaded answers.</Note>
        {err && <p className="mt-2 text-2xs text-danger">{err}</p>}
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Analysis (counts)" title="Preference scores" actions={answers && <Badge tone="cyan">{fmtNum(answers.length)} answered sets</Badge>} />
        {!scores ? <EmptyState title="No answers loaded" body="Upload the fielded answers to score each item." /> : (
          <div className="space-y-2">{scores.map((s) => (
            <div key={s.item} className="grid grid-cols-[minmax(0,1fr)_140px_44px] items-center gap-3 text-[12.5px]"><span className="truncate">{s.item}</span><Bar value={s.index / 100} /><span className="num text-right">{fmtNum(s.index, 0)}</span></div>
          ))}</div>
        )}
        <Note>Score = (times best − times worst) ÷ times shown, rescaled 0–100. Counting analysis only; hierarchical Bayes individual scores are not implemented.</Note>
      </Panel>
    </div>
  );
}

// ───────────────────────── Conjoint

const parseAttrs = (t: string): Attribute[] => lines(t).map((l) => { const [name, rest = ''] = l.split(':'); return { name: name.trim(), levels: rest.split('|').map((x) => x.trim()).filter(Boolean) }; });

function ConjointLab() {
  const [attrText, setAttrText] = useState('Price per month: $19 | $29 | $39 | $49\nContract: Monthly | Annual\nSupport: Email | Chat | Phone 24/7\nStorage: 50 GB | 200 GB | Unlimited');
  const [tasks, setTasks] = useState(10);
  const [alts, setAlts] = useState(3);
  const [versions, setVersions] = useState(10);
  const [choices, setChoices] = useState<ConjointChoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const attrs = parseAttrs(attrText);
  const design = useMemo(() => { try { return { d: conjointDesign({ attributes: attrs, tasks, alternatives: alts, versions, seed: 3 }), e: null }; } catch (e) { return { d: null, e: (e as Error).message }; } }, [attrText, tasks, alts, versions]); // eslint-disable-line react-hooks/exhaustive-deps
  const est = useMemo(() => { if (!choices?.length) return null; try { return { r: conjointEstimate(attrs, choices), e: null }; } catch (e) { return { r: null, e: (e as Error).message }; } }, [choices]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = Object.fromEntries(attrs.map((a) => [a.name, a.levels[0]]));
  const second = Object.fromEntries(attrs.map((a) => [a.name, a.levels[1] ?? a.levels[0]]));
  const [a, setA] = useState<Record<string, string>>(first);
  const [b, setB] = useState<Record<string, string>>(second);
  const shares = est?.r ? conjointSimulate(est.r, [{ ...first, ...a }, { ...second, ...b }]) : null;
  const exportDesign = () => design.d && download('conjoint-design.csv', [['version', 'task', 'alternative', ...attrs.map((x) => x.name)], ...design.d.versions.flatMap((v, vi) => v.flatMap((t, ti) => t.alternatives.map((alt, ai) => [vi + 1, ti + 1, ai + 1, ...alt.map((l, k) => attrs[k].levels[l])])))]);
  const load = (rows: Record<string, string>[]) => {
    setErr(null);
    if (!design.d) return;
    const out: ConjointChoice[] = [];
    for (const [i, r] of rows.entries()) {
      const task = design.d.versions[Number(r.version) - 1]?.[Number(r.task) - 1];
      const chosen = r.chosen === '' || r.chosen?.toLowerCase() === 'none' ? null : Number(r.chosen) - 1;
      if (!task || (chosen !== null && !(chosen >= 0 && chosen < task.alternatives.length))) { setErr(`Row ${i + 2}: needs version, task and chosen (alternative number, or "none") matching the design`); return; }
      out.push({ task, chosen });
    }
    if (!out.length) { setErr('No answer rows found'); return; }
    setChoices(out);
  };
  const Product = ({ label, v, set }: { label: string; v: Record<string, string>; set: (x: Record<string, string>) => void }) => (
    <div className="panel-solid space-y-2 p-3"><div className="text-[12px] font-medium">{label}</div>
      {attrs.map((at) => <select key={at.name} className={inputCls} aria-label={`${label} ${at.name}`} value={v[at.name] ?? at.levels[0]} onChange={(e) => set({ ...v, [at.name]: e.target.value })}>{at.levels.map((l) => <option key={l}>{l}</option>)}</select>)}
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader eyebrow="Design" title="Choice-based conjoint" />
        <Field label="Attributes (Name: level | level | …, one per line)"><textarea className={`${inputCls} h-28 py-2`} value={attrText} onChange={(e) => { setAttrText(e.target.value); setChoices(null); }} /></Field>
        <div className="mt-3 flex flex-wrap gap-3"><NumberField label="Tasks" value={tasks} onChange={(n) => { setTasks(n); setChoices(null); }} min={4} max={20} /><NumberField label="Alternatives" value={alts} onChange={(n) => { setAlts(n); setChoices(null); }} min={2} max={5} /><NumberField label="Versions" value={versions} onChange={(n) => { setVersions(n); setChoices(null); }} min={1} max={50} /></div>
        {design.e ? <p className="mt-3 text-2xs text-danger">{design.e}</p> : design.d && (
          <div className="mt-4 flex flex-wrap items-center gap-2"><Badge>Level balance {fmtPct(design.d.levelBalance, 0)}</Badge><Button size="sm" onClick={exportDesign}><Download size={12} /> Download design CSV</Button><CsvUpload label="Upload choices CSV" onRows={load} /></div>
        )}
        <Note>Field the design (one version per respondent), then upload choices as CSV with columns version, task, chosen (the alternative number, or none).</Note>
        {err && <p className="mt-2 text-2xs text-danger">{err}</p>}
        {est?.e && <p className="mt-2 text-2xs text-danger">{est.e}</p>}
        {est?.r && (
          <div className="mt-4 space-y-4">{est.r.partWorths.map((pw) => {
            const imp = est.r!.importance.find((i) => i.attribute === pw.attribute)!.importance;
            return (
              <div key={pw.attribute}><div className="mb-1 flex justify-between text-[12px]"><span className="font-medium">{pw.attribute}</span><span className="text-ink-3">importance <span className="num">{fmtPct(imp, 0)}</span></span></div>
                <div className="grid grid-cols-4 gap-1.5">{pw.levels.map((l) => <div key={l.level} className="rounded-lg bg-surface-2/40 px-2 py-1 text-[11.5px]"><div className="text-ink-3">{l.level}</div><div className={`num font-semibold ${l.utility >= 0 ? 'text-emerald' : 'text-danger'}`}>{l.utility > 0 ? '+' : ''}{l.utility.toFixed(2)}</div></div>)}</div>
              </div>
            );
          })}<Note>{fmtNum(est.r.fit.choices)} choices · McFadden R² {est.r.fit.mcFaddenR2}. Aggregate logit with effects coding; no individual-level (HB) estimates.</Note></div>
        )}
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Market simulator" title="Share of preference" info="Logit rule over the estimated utilities. Shares describe stated preference among these options only, not market share." />
        {!shares ? <EmptyState title="No choices loaded" body="Upload fielded choices to estimate utilities and simulate shares." /> : (
          <>
            <div className="grid grid-cols-2 gap-3"><Product label="Product A" v={a} set={setA} /><Product label="Product B" v={b} set={setB} /></div>
            <div className="mt-4 space-y-2">{[['Product A', shares[0]], ['Product B', shares[1]]].map(([l, s]) => <div key={l as string} className="grid grid-cols-[90px_1fr_48px] items-center gap-3 text-[12.5px]"><span>{l}</span><Bar value={s as number} tone="cyan" /><span className="num text-right">{fmtPct(s as number, 0)}</span></div>)}</div>
          </>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────── Pricing and portfolio methods on survey data

type Q = { id: string; text: string; options: { code: string; label: string }[] };
type Opts = { survey: { id: string; name: string }; base: number; numeric: Q[]; single: Q[]; multi: Q[]; weightingAvailable: boolean };
type VwRes = ReturnType<typeof vanWestendorp>; type GgRes = ReturnType<typeof gaborGranger>; type TurfRes = ReturnType<typeof turf>;
type Out = { base: number; answered: number; weighted?: boolean } & ({ method: 'vw'; result: VwRes } | { method: 'gg'; result: GgRes } | { method: 'turf'; result: TurfRes });

function useSurveyMethod() {
  const live = useOS((s) => s.mode === 'live' && !!s.session);
  const surveys = useLive<{ id: string; name: string; status: string; hasDefinition?: boolean }[]>('/surveys');
  const [sid, setSid] = useState('');
  const opts = useLive<Opts>(sid ? `/surveys/${sid}/methods` : null, [sid]);
  const [out, setOut] = useState<Out | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { setOut(await api<Out>(`/surveys/${sid}/methods`, { method: 'POST', body })); } catch (e) { setOut(null); setErr(e instanceof ApiError ? e.message : 'Could not reach the API'); } finally { setBusy(false); }
  };
  const picker = (
    <Field label="Survey"><select aria-label="Survey" className={inputCls} value={sid} onChange={(e) => { setSid(e.target.value); setOut(null); setErr(null); }}>
      <option value="">Choose a survey…</option>{(surveys.data ?? []).filter((x) => x.hasDefinition !== false).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select></Field>
  );
  return { live, sid, opts: opts.data, optsError: opts.error, out, err, busy, run, picker };
}
const QSelect = ({ label, qs, value, onChange }: { label: string; qs: Q[]; value: string; onChange: (v: string) => void }) => (
  <Field label={label}><select aria-label={label} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{qs.map((q) => <option key={q.id} value={q.id}>{q.id} · {q.text.slice(0, 60)}</option>)}</select></Field>
);

function VwLab() {
  const m = useSurveyMethod();
  const [map, setMap] = useState({ tooCheap: '', cheap: '', expensive: '', tooExpensive: '' });
  const res = m.out?.method === 'vw' ? m.out.result : null;
  const p = res?.points;
  const pts: [string, number | null][] = p ? [['Point of marginal cheapness', p.pointOfMarginalCheapness], ['Optimal price point', p.optimalPricePoint], ['Indifference price point', p.indifferencePricePoint], ['Point of marginal expensiveness', p.pointOfMarginalExpensiveness]] : [];
  return (
    <Panel>
      <PanelHeader eyebrow="Price sensitivity meter" title="Van Westendorp" />
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-2">
          {m.picker}
          {m.opts && (m.opts.numeric.length < 4 ? <p className="text-2xs text-ink-3">This survey needs four numeric price questions (too cheap, cheap, expensive, too expensive); it has {m.opts.numeric.length}.</p> : (
            <>
              {(['tooCheap', 'cheap', 'expensive', 'tooExpensive'] as const).map((k, i) => <QSelect key={k} label={['Too cheap at', 'Cheap (a bargain) at', 'Getting expensive at', 'Too expensive at'][i]} qs={m.opts!.numeric} value={map[k]} onChange={(v) => setMap({ ...map, [k]: v })} />)}
              <Button size="sm" variant="primary" disabled={m.busy || Object.values(map).some((v) => !v)} onClick={() => m.run({ method: 'vw', ...map })}>Analyse {fmtNum(m.opts.base)} interviews</Button>
            </>
          ))}
          {m.err && <p className="text-2xs text-danger">{m.err}</p>}
        </div>
        {!res ? <EmptyState title={m.live ? 'Choose a survey and map its price questions' : 'Sign in to analyse survey data'} /> : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <EChart ariaLabel="Van Westendorp curves" height={300} deps={[res]} option={(t) => ({
              tooltip: { trigger: 'axis', valueFormatter: (v) => fmtPct(Number(v), 0) }, legend: { top: 0 }, grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
              xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', ...axis(t) },
              yAxis: { type: 'value', max: 1, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
              series: (['tooCheap', 'cheap', 'expensive', 'tooExpensive'] as const).map((k, i) => ({ type: 'line', name: ['Too cheap', 'Cheap', 'Expensive', 'Too expensive'][i], showSymbol: false, smooth: false, data: res.curves.map((c) => [c.price, c[k]]), lineStyle: { width: 2, type: i === 1 || i === 2 ? 'dashed' : 'solid' } })),
            })} />
            <div className="space-y-2">
              {pts.map(([l, v]) => <div key={l} className="panel-solid flex justify-between px-3 py-2 text-[12.5px]"><span>{l}</span><span className="num font-semibold">{v == null ? 'none' : v.toFixed(2)}</span></div>)}
              <p className="text-2xs text-ink-3">{res.n} consistent answers used, {res.excluded} excluded for answering out of order. Unweighted.</p>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function GgLab() {
  const m = useSurveyMethod();
  const [rows, setRows] = useState<{ price: number; questionId: string; yes: string[] }[]>([{ price: 10, questionId: '', yes: [] }, { price: 20, questionId: '', yes: [] }]);
  const res = m.out?.method === 'gg' ? m.out.result : null;
  const qOf = (id: string) => m.opts?.single.find((q) => q.id === id);
  return (
    <Panel>
      <PanelHeader eyebrow="Demand curve" title="Gabor-Granger" />
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-2">
          {m.picker}
          {m.opts && (m.opts.single.length < 2 ? <p className="text-2xs text-ink-3">This survey needs a single-choice purchase question per price point; it has {m.opts.single.length} single-choice questions.</p> : (
            <>
              {rows.map((r, i) => (
                <div key={i} className="panel-solid space-y-2 p-2">
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                    <Field label="Price"><input type="number" className={inputCls} value={r.price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: +e.target.value } : x)))} /></Field>
                    <QSelect label="Question" qs={m.opts!.single} value={r.questionId} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, questionId: v, yes: [] } : x)))} />
                  </div>
                  {qOf(r.questionId) && <div className="flex flex-wrap gap-2 text-2xs"><span className="text-ink-3">Counts as would buy:</span>{qOf(r.questionId)!.options.map((o) => (
                    <label key={o.code} className="flex items-center gap-1"><input type="checkbox" checked={r.yes.includes(o.code)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, yes: e.target.checked ? [...x.yes, o.code] : x.yes.filter((c) => c !== o.code) } : x)))} />{o.label}</label>
                  ))}</div>}
                </div>
              ))}
              <div className="flex gap-2">
                {rows.length < 12 && <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { price: (rows.at(-1)?.price ?? 0) + 10, questionId: '', yes: [] }])}>Add price point</Button>}
                <Button size="sm" variant="primary" disabled={m.busy || rows.some((r) => !r.questionId || !r.yes.length)} onClick={() => m.run({ method: 'gg', prices: rows })}>Analyse</Button>
              </div>
            </>
          ))}
          {m.err && <p className="text-2xs text-danger">{m.err}</p>}
        </div>
        {!res ? <EmptyState title={m.live ? 'Choose a survey and map a question to each price' : 'Sign in to analyse survey data'} /> : (
          <div>
            <EChart ariaLabel="Gabor-Granger demand and revenue" height={260} deps={[res]} option={(t) => ({
              tooltip: { trigger: 'axis' }, legend: { top: 0 }, grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: res.curve.map((c) => String(c.price)), ...axis(t), splitLine: { show: false } },
              yAxis: [{ type: 'value', max: 1, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } }, { type: 'value', ...axis(t), splitLine: { show: false } }],
              series: [
                { type: 'bar', name: 'Would buy', data: res.curve.map((c) => c.demand), itemStyle: { borderRadius: [4, 4, 0, 0] } },
                { type: 'line', name: 'Revenue index', yAxisIndex: 1, data: res.curve.map((c) => c.revenueIndex) },
              ],
            })} />
            <div className="mt-2 flex flex-wrap gap-1.5"><Badge tone="blue">Revenue-maximising price {res.revenueMaximisingPrice}</Badge>{res.elasticity.map((e) => <Badge key={e.from}>{e.from}→{e.to}: elasticity {e.elasticity}</Badge>)}</div>
            <Note>Demand at each price is the share of interviews answering that price question with a would-buy answer ({fmtNum(m.out!.answered)} answered). Revenue index = price × demand; it ignores cost and competitor response.</Note>
          </div>
        )}
      </div>
    </Panel>
  );
}

function TurfLab() {
  const m = useSurveyMethod();
  const [qid, setQid] = useState('');
  const [k, setK] = useState(3);
  const [weighted, setWeighted] = useState(false);
  const res = m.out?.method === 'turf' ? m.out.result : null;
  return (
    <Panel>
      <PanelHeader eyebrow="Portfolio reach" title="TURF" />
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-2">
          {m.picker}
          {m.opts && (!m.opts.multi.length ? <p className="text-2xs text-ink-3">This survey has no multi-choice question to use as the item list.</p> : (
            <>
              <QSelect label="Items (multi-choice question)" qs={m.opts.multi} value={qid} onChange={setQid} />
              <NumberField label="Portfolio size" value={k} onChange={setK} min={1} max={10} />
              {m.opts.weightingAvailable && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={weighted} onChange={(e) => setWeighted(e.target.checked)} /> Use Data Processing weights</label>}
              <Button size="sm" variant="primary" disabled={m.busy || !qid} onClick={() => m.run({ method: 'turf', questionId: qid, k, weighted })}>Analyse {fmtNum(m.opts.base)} interviews</Button>
            </>
          ))}
          {m.err && <p className="text-2xs text-danger">{m.err}</p>}
        </div>
        {!res ? <EmptyState title={m.live ? 'Choose a survey and its item question' : 'Sign in to analyse survey data'} /> : (
          <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
            <div className="panel-solid p-3 text-center"><div className="text-2xs text-ink-3">Unduplicated reach</div><div className="num font-display text-3xl font-semibold text-blue">{fmtPct(res.reach, 0)}</div><div className="text-2xs text-ink-3">avg {res.frequency.toFixed(2)} items per person · {res.method === 'exhaustive' ? 'every combination checked' : 'greedy search'}</div></div>
            <div className="space-y-2">{res.ladder.map((l, i) => (
              <div key={l.item} className="grid grid-cols-[22px_minmax(0,1fr)_160px_90px] items-center gap-3 text-[12.5px]"><span className="num text-ink-3">{i + 1}</span><span>{l.item}</span><Bar value={l.reach} tone="emerald" /><span className="num text-right">{fmtPct(l.reach, 0)} <span className="text-ink-3">+{fmtPct(l.increment, 0)}</span></span></div>
            ))}</div>
            <Note>Reach is the share of {fmtNum(m.out!.base)} completed interviews{m.out!.weighted ? ' (weighted)' : ''} choosing at least one item in the line-up. Exclusive options such as None are not items.</Note>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function MethodsLab() {
  const [m, setM] = useState<Method>('maxdiff');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Method" value={m} onChange={setM} options={[{ value: 'maxdiff', label: 'MaxDiff' }, { value: 'conjoint', label: 'Conjoint' }, { value: 'vw', label: 'Van Westendorp' }, { value: 'gg', label: 'Gabor-Granger' }, { value: 'turf', label: 'TURF' }]} />
        <span className="text-2xs text-ink-3">{m === 'maxdiff' || m === 'conjoint' ? 'Design for fielding, then analyse the uploaded answers (not stored).' : 'Computed from the chosen survey\'s completed, non-rejected interviews.'}</span>
      </div>
      {m === 'maxdiff' && <MaxDiffLab />}
      {m === 'conjoint' && <ConjointLab />}
      {m === 'vw' && <VwLab />}
      {m === 'gg' && <GgLab />}
      {m === 'turf' && <TurfLab />}
    </div>
  );
}

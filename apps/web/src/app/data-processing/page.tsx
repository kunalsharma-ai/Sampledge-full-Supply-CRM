'use client';
/**
 * Data Processing: weighting, open-end coding and tables on recorded responses (live API only).
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Scale, Sparkles, Tags, Trash2 } from 'lucide-react';
import { access } from '@/lib/core';
import { api } from '@/lib/api';
import { act, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtNum, fmtPct } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Bar, Button, DemoBadge, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';
import { LiveOnly, Loadable } from '@/components/ui/data';

type Code = { code: string; label: string; keywords: string[] };
type Stats = { iterations: number; converged: boolean; maxDeviation: number; efficiency: number; effectiveBase: number; minWeight: number; maxWeight: number; excluded: number; achieved: Record<string, Record<string, { target: number; unweighted: number; weighted: number }>> };
type Overview = {
  survey: { id: string; name: string; status: string; version: number }; completes: number; rejected: number; synthetic: number; outcomes: Record<string, number>; medianMinutes: number | null; flags: Record<string, number>;
  weighting: { targets: Record<string, Record<string, number>>; stats: Stats; appliedAt: string; by: string } | null;
  weightingVariables: { id: string; text: string; options: { code: string; label: string; share: number }[] }[];
  openEnds: { id: string; text: string; answered: number; coded: number; manual: number; codeframe: Code[] | null }[];
};
type Verbatim = { id: string; text: string; codes: string[]; manual: boolean };

function Weighting({ o, write, onDone }: { o: Overview; write: boolean; onDone: () => void }) {
  const init = () => {
    const t: Record<string, Record<string, string>> = {};
    for (const v of o.weightingVariables) if (o.weighting?.targets[v.id]) t[v.id] = Object.fromEntries(v.options.map((x) => [x.code, String(Math.round((o.weighting!.targets[v.id][x.code] ?? 0) * 1000) / 10)]));
    return t;
  };
  const [t, setT] = useState<Record<string, Record<string, string>>>(init);
  const [stats, setStats] = useState<Stats | null>(o.weighting?.stats ?? null);
  useEffect(() => { setT(init()); setStats(o.weighting?.stats ?? null); }, [o.survey.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (v: Overview['weightingVariables'][number]) => setT((x) => { const n = { ...x }; if (n[v.id]) delete n[v.id]; else n[v.id] = Object.fromEntries(v.options.map((op) => [op.code, String(Math.round(op.share * 1000) / 10)])); return n; });
  const sums = Object.fromEntries(Object.entries(t).map(([v, m]) => [v, Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0)]));
  const ok = Object.keys(t).length > 0 && Object.values(sums).every((s) => Math.abs(s - 100) <= 0.5);
  const apply = async () => {
    const targets = Object.fromEntries(Object.entries(t).map(([v, m]) => [v, Object.fromEntries(Object.entries(m).map(([c, p]) => [c, (Number(p) || 0) / 100]))]));
    const r = await act(() => api<Stats>(`/dp/surveys/${o.survey.id}/weighting`, { method: 'PUT', body: { targets } }), (s) => `Weights applied: efficiency ${fmtPct(s.efficiency, 0)}, effective base ${fmtNum(s.effectiveBase)}`);
    if (r) { setStats(r); onDone(); }
  };
  const remove = async () => { if (await act(() => api(`/dp/surveys/${o.survey.id}/weighting`, { method: 'DELETE' }), 'Weighting removed; results are unweighted again')) { setStats(null); setT({}); onDone(); } };
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel>
        <PanelHeader eyebrow="Rim weighting" title="Targets" info="Pick the variables to weight on and enter population shares. Raking adjusts weights until every variable matches its targets; weights are capped between 0.2 and 5." />
        <div className="space-y-4">{o.weightingVariables.map((v) => (
          <div key={v.id} className={cn('panel-solid p-3', t[v.id] && 'ring-1 ring-inset ring-cyan/40')}>
            <label className="flex items-center gap-2 text-[12.5px] font-medium"><input type="checkbox" checked={!!t[v.id]} onChange={() => toggle(v)} disabled={!write} aria-label={`Weight on ${v.id}`} /> {v.id}. {v.text}
              {t[v.id] && <span className={cn('num ml-auto text-2xs', Math.abs(sums[v.id] - 100) <= 0.5 ? 'text-emerald' : 'text-danger')}>{sums[v.id].toFixed(1)}%</span>}</label>
            {t[v.id] && (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">{v.options.map((op) => (
                <div key={op.code} className="text-[12px]"><div className="mb-0.5 truncate text-ink-3">{op.label} <span className="num">· sample {fmtPct(op.share, 0)}</span></div>
                  <input className={inputCls} type="number" min={0} max={100} step={0.1} value={t[v.id][op.code] ?? ''} onChange={(e) => setT((x) => ({ ...x, [v.id]: { ...x[v.id], [op.code]: e.target.value } }))} aria-label={`${v.id} ${op.label} target %`} disabled={!write} /></div>
              ))}</div>
            )}
          </div>
        ))}</div>
        {write && <div className="mt-4 flex flex-wrap gap-2"><Button variant="primary" disabled={!ok} onClick={apply}><Scale size={14} /> Apply weights</Button>{o.weighting && <Button onClick={remove}><Trash2 size={14} /> Remove weighting</Button>}</div>}
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Diagnostics" title={stats ? (stats.converged ? `Converged in ${stats.iterations} iterations` : `Did not fully converge (max gap ${fmtPct(stats.maxDeviation, 1)})`) : 'Not weighted'} />
        {stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-center text-[12px] sm:grid-cols-4">
              {([['Efficiency', fmtPct(stats.efficiency, 0)], ['Effective base', fmtNum(stats.effectiveBase)], ['Min weight', stats.minWeight.toFixed(2)], ['Max weight', stats.maxWeight.toFixed(2)]] as const).map(([l, v]) => <div key={l} className="panel-solid p-2"><div className="text-2xs text-ink-3">{l}</div><div className="num font-semibold">{v}</div></div>)}
            </div>
            {Object.entries(stats.achieved).map(([v, m]) => (
              <table key={v} className="w-full text-[12px]"><thead><tr className="text-2xs text-ink-3"><th className="text-left font-medium">{v}</th><th className="text-right font-medium">Sample</th><th className="text-right font-medium">Target</th><th className="text-right font-medium">Weighted</th></tr></thead>
                <tbody>{Object.entries(m).map(([c, x]) => <tr key={c} className="border-t hairline"><td className="py-1">{o.weightingVariables.find((w) => w.id === v)?.options.find((op) => op.code === c)?.label ?? c}</td><td className="num text-right">{fmtPct(x.unweighted, 1)}</td><td className="num text-right">{fmtPct(x.target, 1)}</td><td className="num text-right font-medium">{fmtPct(x.weighted, 1)}</td></tr>)}</tbody></table>
            ))}
            {stats.excluded > 0 && <p className="text-2xs text-orange">{stats.excluded} interviews lack a weighting variable and keep weight 1.</p>}
            {o.weighting && <p className="text-2xs text-ink-3">Applied by {o.weighting.by} on {new Date(o.weighting.appliedAt).toLocaleString('en-GB')}. Insight Studio and exports use these weights when “Weighted” is chosen.</p>}
          </div>
        ) : <EmptyState title="Results are unweighted" body="Set targets and apply to compute weights. Efficiency below about 70% means a few interviews carry a lot of weight." />}
      </Panel>
    </div>
  );
}

function Coding({ o, write, onDone }: { o: Overview; write: boolean; onDone: () => void }) {
  const [qid, setQid] = useState(o.openEnds[0]?.id ?? '');
  const q = o.openEnds.find((x) => x.id === qid);
  const [frame, setFrame] = useState<Code[]>(q?.codeframe ?? []);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { setFrame(q?.codeframe ?? []); setNote(null); }, [qid, o.survey.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const verb = useLive<Verbatim[]>(q?.codeframe ? `/dp/surveys/${o.survey.id}/codeframes/${qid}/verbatims?take=60${filter ? `&code=${filter}` : ''}` : null, [qid, filter, tick, o.survey.id]);
  if (!q) return <Panel><EmptyState title="No open-ended questions in this survey" /></Panel>;
  const suggest = async () => {
    const r = await act(() => api<{ data: { codes: Code[] }; note: string; answers: number }>(`/dp/surveys/${o.survey.id}/codeframes/${qid}/suggest`, { method: 'POST', body: { maxCodes: 10 } }), (x) => `${x.data.codes.length} codes suggested from ${fmtNum(x.answers)} answers. Review before saving.`);
    if (r) { setFrame(r.data.codes); setNote(r.note); }
  };
  const save = async () => { if (await act(() => api<{ coded: number }>(`/dp/surveys/${o.survey.id}/codeframes/${qid}`, { method: 'PUT', body: { codes: frame.filter((c) => c.label.trim()) } }), (x) => `Codeframe saved; ${fmtNum(x.coded)} answers coded. Manual codes were kept.`)) { onDone(); setTick((t) => t + 1); } };
  const setCodes = async (v: Verbatim, code: string) => {
    const next = v.codes.includes(code) ? v.codes.filter((c) => c !== code) : [...v.codes.filter((c) => c !== 'other'), code];
    if (await act(() => api(`/dp/responses/${v.id}/codes`, { method: 'PATCH', body: { questionId: qid, codes: next } }), 'Code updated (manual)')) setTick((t) => t + 1);
  };
  const edit = (i: number, patch: Partial<Code>) => setFrame((f) => f.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const saved = q.codeframe ?? [];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel>
        <PanelHeader eyebrow="Codeframe" title={`${q.id}. ${q.text}`} actions={o.openEnds.length > 1 && <select className={cn(inputCls, 'w-28')} value={qid} onChange={(e) => setQid(e.target.value)} aria-label="Open-ended question">{o.openEnds.map((x) => <option key={x.id}>{x.id}</option>)}</select>} />
        <div className="mb-3 flex flex-wrap gap-1.5 text-2xs"><Badge tone="blue">{fmtNum(q.answered)} answers</Badge><Badge tone={q.coded ? 'emerald' : 'neutral'}>{fmtNum(q.coded)} coded</Badge>{q.manual > 0 && <Badge tone="purple">{q.manual} coded by hand</Badge>}</div>
        <div className="space-y-2">{frame.map((c, i) => (
          <div key={i} className="grid grid-cols-[70px_minmax(0,1fr)_minmax(0,1.2fr)_28px] items-center gap-2">
            <input className={cn(inputCls, 'font-mono text-[11.5px]')} value={c.code} onChange={(e) => edit(i, { code: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} aria-label="Code" disabled={!write} />
            <input className={inputCls} value={c.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label="Label" disabled={!write} />
            <input className={inputCls} value={c.keywords.join(', ')} onChange={(e) => edit(i, { keywords: e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) })} aria-label="Keywords" disabled={!write} />
            {write && <button type="button" className="text-ink-3 hover:text-danger" onClick={() => setFrame((f) => f.filter((_, j) => j !== i))} aria-label={`Remove ${c.code}`}><Trash2 size={14} /></button>}
          </div>
        ))}</div>
        {!frame.length && <EmptyState title="No codeframe yet" body="Suggest one from the answers, or add codes by hand. Keywords drive the automatic first pass; you can correct any answer afterwards." />}
        {note && <p className="mt-2 text-2xs text-cyan">{note}</p>}
        {write && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={suggest}><Sparkles size={14} /> Suggest codeframe</Button>
            <Button onClick={() => setFrame((f) => [...f, { code: `C${f.length + 1}`, label: '', keywords: [] }])}><Plus size={14} /> Add code</Button>
            <Button variant="primary" disabled={!frame.some((c) => c.label.trim())} onClick={save}><Tags size={14} /> Save and code answers</Button>
          </div>
        )}
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Verbatims" title="Review coding" actions={saved.length > 0 && <select className={cn(inputCls, 'w-48')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by code"><option value="">All answers</option>{saved.map((c) => <option key={c.code} value={c.code}>{c.code}: {c.label}</option>)}<option value="other">Other</option></select>} />
        {!saved.length ? <EmptyState title="Save a codeframe to start coding" /> : (
          <Loadable q={verb}>{(rows) => rows.length ? (
            <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1">{rows.map((v) => (
              <div key={v.id} className="panel-solid px-3 py-2 text-[12.5px]">
                <div>“{v.text}”</div>
                <div className="mt-1.5 flex flex-wrap gap-1">{saved.map((c) => (
                  <button key={c.code} type="button" disabled={!write} onClick={() => setCodes(v, c.code)} className={cn('rounded-full border px-2 py-0.5 text-2xs', v.codes.includes(c.code) ? 'border-cyan/60 bg-cyan/15 text-cyan' : 'hairline text-ink-3 hover:text-ink')}>{c.label}</button>
                ))}{v.codes.includes('other') && <Badge>Other</Badge>}{v.manual && <Badge tone="purple">manual</Badge>}</div>
              </div>
            ))}</div>
          ) : <EmptyState title="No answers with this code" />}</Loadable>
        )}
      </Panel>
    </div>
  );
}

function Tables({ o }: { o: Overview }) {
  const [banner, setBanner] = useState('');
  const [weighted, setWeighted] = useState(!!o.weighting);
  const qs = `banner=${encodeURIComponent(banner)}&weighted=${weighted}`;
  return (
    <Panel>
      <PanelHeader eyebrow="Tabulation" title="Tables and reports" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72"><Field label="Banner (columns)"><select className={inputCls} value={banner} onChange={(e) => setBanner(e.target.value)} aria-label="Banner question"><option value="">Total only</option>{o.weightingVariables.map((v) => <option key={v.id} value={v.id}>{v.id}: {v.text.slice(0, 40)}</option>)}</select></Field></div>
        <Segmented label="Weighting" value={weighted ? 'w' : 'u'} onChange={(v) => setWeighted(v === 'w')} options={[{ value: 'u', label: 'Unweighted' }, { value: 'w', label: o.weighting ? 'Weighted' : 'Weighted (not set)' }]} />
        <a className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue px-3 text-[13px] font-medium text-white hover:opacity-90" href={`/api/v1/dp/surveys/${o.survey.id}/tables.xlsx?${qs}`} download><Download size={14} /> Excel tables</a>
        <a className="inline-flex h-9 items-center gap-1.5 rounded-xl border hairline px-3 text-[13px] hover:bg-surface-2/60" href={`/api/v1/surveys/${o.survey.id}/report.pptx?${qs}`} download><Download size={14} /> PowerPoint report</a>
      </div>
      <p className="mt-3 text-2xs text-ink-3">Every question against the banner. Percentages are weighted when chosen; significance letters use the effective base. Coded open ends appear as code frequencies. Exports are recorded in the audit log.</p>
    </Panel>
  );
}

function Inner() {
  const role = useOS((s) => s.role);
  const write = access(role, 'data-processing') === 'full';
  const list = useLive<{ id: string; name: string; status: string; completes: number; weighted: boolean; codeframes: number }[]>('/dp/surveys');
  const [sid, setSid] = useState('');
  const [tab, setTab] = useState<'weighting' | 'coding' | 'tables'>('weighting');
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!sid && list.data?.length) setSid([...list.data].sort((a, b) => b.completes - a.completes)[0].id); }, [list.data, sid]);
  const ov = useLive<Overview>(sid ? `/dp/surveys/${sid}` : null, [sid, tick]);
  const flagTotal = useMemo(() => Object.values(ov.data?.flags ?? {}).reduce((a, b) => a + b, 0), [ov.data]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80"><Field label="Survey"><select className={inputCls} value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Survey">{(list.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.completes} completes)</option>)}</select></Field></div>
        <Segmented label="Data processing step" value={tab} onChange={setTab} options={[{ value: 'weighting', label: 'Weighting' }, { value: 'coding', label: 'Open-end coding' }, { value: 'tables', label: 'Tables' }]} />
        {!write && <Badge>Read only for your role</Badge>}
      </div>
      <Loadable q={ov}>{(o) => (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Completed interviews" value={o.completes} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
            <KpiCard label="Screen-outs" value={o.outcomes.screenout ?? 0} format={(n) => fmtNum(n)} />
            <KpiCard label="Quality-flagged" value={flagTotal} format={(n) => fmtNum(n)} color="rgb(var(--orange))" />
            <KpiCard label="Rejected (excluded)" value={o.rejected} format={(n) => fmtNum(n)} color="rgb(var(--danger))" />
            <KpiCard label="Median length" value={o.medianMinutes ?? 0} format={(n) => `${n.toFixed(1)} min`} />
          </div>
          {o.synthetic > 0 && <div className="flex items-center gap-2 text-[12px] text-orange"><DemoBadge label="Synthetic interviews" /> {fmtNum(o.synthetic)} of these interviews were generated for the demo. They are not real respondents.</div>}
          {tab === 'weighting' && <Weighting o={o} write={write} onDone={() => setTick((t) => t + 1)} />}
          {tab === 'coding' && <Coding o={o} write={write} onDone={() => setTick((t) => t + 1)} />}
          {tab === 'tables' && <Tables o={o} />}
          {tab === 'coding' && o.openEnds.some((q) => q.codeframe) && (
            <Panel><PanelHeader eyebrow="Coded" title="Share of answers per code" />
              <CodeTally sid={o.survey.id} qid={o.openEnds.find((q) => q.codeframe)!.id} tick={tick} /></Panel>
          )}
        </>
      )}</Loadable>
    </div>
  );
}

function CodeTally({ sid, qid, tick }: { sid: string; qid: string; tick: number }) {
  const r = useLive<{ questions: { id: string; type: string; coded?: { code: string; label: string; pct: number }[] }[] }>(`/surveys/${sid}/results`, [tick, sid]);
  const q = r.data?.questions.find((x) => x.id === qid);
  if (!q?.coded) return null;
  return <div className="space-y-2">{[...q.coded].sort((a, b) => b.pct - a.pct).map((c) => <div key={c.code} className="grid grid-cols-[minmax(0,1fr)_200px_48px] items-center gap-3 text-[12.5px]"><span className="truncate">{c.label}</span><Bar value={c.pct} tone="cyan" /><span className="num text-right">{fmtPct(c.pct, 0)}</span></div>)}</div>;
}

export default function DataProcessingPage() {
  return (
    <div>
      <PageHeader eyebrow="Data Processing" title="Weighting, coding and tables" subtitle="Work on recorded interviews: rim weighting to population targets, open-end codeframes with keyword coding and manual review, and Excel tables against any banner." />
      <LiveOnly what="Data processing"><Inner /></LiveOnly>
    </div>
  );
}

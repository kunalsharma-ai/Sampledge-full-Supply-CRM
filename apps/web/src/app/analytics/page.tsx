'use client';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import { Box, Database, Download, Maximize2, Minimize2, ScatterChart, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { crosstab, kmeans, makeDataset, metrics, vars, weights, type CatVar, type Metric } from '@/lib/core';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { cn, fmtNum, fmtPct } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, DemoBadge, PageHeader, Panel, PanelHeader, Segmented, Skeleton, inputCls } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';

const Scatter3D = dynamic(() => import('@/components/three/scatter3d'), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });
const DATASET = { id: 'ds-brand-health-q4', name: 'Brand Health Tracker Q4', version: 3, validated: '2026-10-29', project: 'SE-26100' };
const segColors = [palette.cyan, palette.purple, palette.orange];
const segNames = ['Value seekers', 'Quality loyalists', 'Early adopters'];

export default function AnalyticsPage() {
  const toast = useOS((s) => s.toast);
  const reduced = useOS((s) => s.motion === 'reduced');
  const data = useMemo(() => makeDataset(), []);
  const [weighted, setWeighted] = useState(true);
  const [row, setRow] = useState<CatVar>('brand');
  const [col, setCol] = useState<CatVar>('age');
  const [metric, setMetric] = useState<Metric>('consider');
  const [view3d, setView3d] = useState(true);
  const [present, setPresent] = useState(false);
  const w = useMemo(() => weights(data, weighted), [data, weighted]);
  const xt = useMemo(() => crosstab(data, w, row, col === row ? (row === 'age' ? 'gender' : 'age') : col, metric), [data, w, row, col, metric]);
  const seg = useMemo(() => { const pts = data.map((d) => [d.price, d.quality, d.innovation]); return { pts, ...kmeans(pts, 3) }; }, [data]);
  // name each cluster by its strongest centroid dimension so labels follow the data
  const segLabel = seg.centroids.map((c) => segNames[c.indexOf(Math.max(...c))]);
  const W = w.reduce((s, x) => s + x, 0);
  const share = (f: (i: number) => boolean) => data.reduce((s, _, i) => s + (f(i) ? w[i] : 0), 0) / W;
  const funnel = vars.brand.map((b) => ['aware', 'consider', 'purchase', 'loyal'].map((k) => share((i) => data[i].brand === b && data[i][k as 'aware'] === 1) / share((i) => data[i].brand === b)));
  const npsScore = (b?: string) => { const idx = data.map((_, i) => i).filter((i) => !b || data[i].brand === b); const tw = idx.reduce((s, i) => s + w[i], 0); return (idx.reduce((s, i) => s + (data[i].nps >= 9 ? w[i] : 0), 0) - idx.reduce((s, i) => s + (data[i].nps <= 6 ? w[i] : 0), 0)) / tw * 100; };
  const best = vars.brand.map((b, i) => ({ b, c: funnel[i][1] })).sort((a, b) => b.c - a.c);
  const [narrative, setNarrative] = useState<string | null>(null);
  const draft = `${best[0].b} leads consideration at ${fmtPct(best[0].c, 0)} among all respondents, ${((best[0].c - best[best.length - 1].c) * 100).toFixed(0)} pts ahead of ${best[best.length - 1].b}. Overall NPS is ${npsScore().toFixed(0)}. ${(() => { const k = xt.table.flat().filter((c) => c.sigHigher.length).length; return `${k} crosstab cell${k === 1 ? ' is' : 's are'}`; })()} significantly higher than at least one other column at 95% confidence${weighted ? ' (age-weighted to population targets, Kish effective bases)' : ' (unweighted)'}.`;

  const exportCsv = () => {
    const lines = [['', ...xt.cols.map((c, i) => `${c} (${xt.letters[i]})`)].join(','), ...xt.rows.map((r, ri) => [r, ...xt.table[ri].map((c) => `${(c.pct * 100).toFixed(1)}%${c.sigHigher.length ? ' ' + c.sigHigher.join('') : ''}`)].join(',')), ['Base', ...xt.totals.map((t) => t.toFixed(0))].join(',')];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `crosstab_${row}_x_${col}_${metric}.csv`; a.click(); URL.revokeObjectURL(url);
    toast('Crosstab exported as CSV');
  };

  return (
    <div className={cn(present && 'fixed inset-0 z-[55] overflow-y-auto bg-bg p-8')}>
      <PageHeader eyebrow="Insight Studio" title="Advanced analytics & reporting" subtitle="Crosstabs with significance testing, weighting, segmentation and narrative, all computed from a validated dataset."
        actions={<>
          <Badge tone="cyan"><Database size={10} /> {DATASET.name} v{DATASET.version} · n={fmtNum(data.length)}</Badge><DemoBadge label="Simulated respondents" />
          <Segmented label="wt" value={weighted ? 'w' : 'u'} onChange={(v) => setWeighted(v === 'w')} options={[{ value: 'w', label: 'Weighted' }, { value: 'u', label: 'Unweighted' }]} />
          <Button onClick={() => setPresent(!present)}>{present ? <><Minimize2 size={14} /> Exit presentation</> : <><Maximize2 size={14} /> Presentation view</>}</Button>
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Respondents (base)" value={data.length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="Effective base" value={Math.round(W * W / w.reduce((s, x) => s + x * x, 0))} format={(n) => fmtNum(n)} status={{ tone: 'ok', text: weighted ? 'Weighting efficiency applied' : 'Unweighted' }} />
        <KpiCard label="Overall NPS" value={npsScore()} format={(n) => n.toFixed(1)} color="rgb(var(--emerald))" />
        <KpiCard label="Category consideration" value={share((i) => data[i].consider === 1)} format={(n) => fmtPct(n)} color="rgb(var(--purple))" />
        <KpiCard label="Data quality pass rate" value={0.962} format={(n) => fmtPct(n)} status={{ tone: 'ok', text: 'Speeders & straightliners removed' }} color="rgb(var(--cyan))" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader eyebrow="Cross-tabulation explorer" title={`${metrics[metric]} by ${row} × ${col}`} actions={<Button size="sm" onClick={exportCsv}><Download size={12} /> CSV</Button>} />
          <div className="mb-4 grid grid-cols-3 gap-2">
            <select aria-label="Metric" className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>{Object.entries(metrics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select aria-label="Rows" className={inputCls} value={row} onChange={(e) => setRow(e.target.value as CatVar)}>{Object.keys(vars).map((k) => <option key={k} value={k}>Rows: {k}</option>)}</select>
            <select aria-label="Columns" className={inputCls} value={col} onChange={(e) => setCol(e.target.value as CatVar)}>{Object.keys(vars).filter((k) => k !== row).map((k) => <option key={k} value={k}>Columns: {k}</option>)}</select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b hairline text-2xs text-ink-3"><th className="py-2 text-left font-semibold">{row}</th>{xt.cols.map((c, i) => <th key={c} className="px-2 py-2 text-right font-semibold">{c} <span className="text-cyan">({xt.letters[i]})</span></th>)}</tr></thead>
              <tbody>
                {xt.rows.map((r, ri) => (
                  <tr key={r} className="border-b hairline last:border-0">
                    <td className="py-2 font-medium">{r}</td>
                    {xt.table[ri].map((c, ci) => (
                      <td key={ci} className="px-2 py-1.5 text-right">
                        <div className="relative ml-auto inline-flex min-w-[78px] items-center justify-end gap-1 rounded-lg px-2 py-1" style={{ background: `rgba(24,215,242,${(c.pct * 0.45).toFixed(3)})` }}>
                          <span className="num font-semibold">{fmtPct(c.pct, 0)}</span>
                          {c.sigHigher.length > 0 && <span className="text-[10px] font-bold text-emerald">{c.sigHigher.join('')}</span>}
                        </div>
                        <div className="num text-[10px] text-ink-3">n={c.base.toFixed(0)}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-2xs text-ink-3">Letters mark a column significantly higher than the lettered column (two-proportion z-test, 95%, effective bases). Cells with effective n &lt; 30 are not tested.</p>
        </Panel>

        <Panel>
          <PanelHeader eyebrow="Segmentation" title="Attitudinal segments (k-means, k=3)" actions={<Segmented size="sm" label="seg-view" value={view3d ? '3d' : '2d'} onChange={(v) => setView3d(v === '3d')} options={[{ value: '3d', label: <span className="flex items-center gap-1"><Box size={11} />3D</span> }, { value: '2d', label: <span className="flex items-center gap-1"><ScatterChart size={11} />2D</span> }]} />} />
          <div className="h-[330px]">
            {view3d ? <Scatter3D points={seg.pts} colors={segColors} labels={seg.assign} reduced={reduced} axes={['Price sensitivity', 'Quality focus', 'Innovation appetite']} /> : (
              <EChart ariaLabel="2D segment scatter" height={330} deps={[]} option={(t) => ({
                tooltip: { trigger: 'item' }, legend: { right: 0 },
                xAxis: { type: 'value', name: 'Price sensitivity', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t) }, yAxis: { type: 'value', name: 'Quality focus', nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t) },
                series: [0, 1, 2].map((k) => ({ name: segLabel[k], type: 'scatter', symbolSize: 4, itemStyle: { color: segColors[k], opacity: 0.7 }, data: seg.pts.filter((_, i) => seg.assign[i] === k).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]) })),
              })} />
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            {[0, 1, 2].map((k) => { const n = seg.assign.filter((a) => a === k).length; return (
              <div key={k} className="panel-solid p-2.5"><div className="flex items-center gap-1.5 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: segColors[k] }} />{segLabel[k]}</div><div className="num text-2xs text-ink-3">{fmtPct(n / data.length, 0)} · n={n}</div></div>
            ); })}
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader eyebrow="Brand journey" title="Awareness → consideration → purchase → loyalty" />
          <EChart ariaLabel="Brand journey sankey" height={300} deps={[weighted]} option={(t) => {
            const stages = ['Aware', 'Consider', 'Purchase', 'Loyal'];
            const nodes = [{ name: 'All respondents', itemStyle: { color: palette.blue } }, ...vars.brand.flatMap((b, bi) => stages.map((s) => ({ name: `${b} · ${s}`, itemStyle: { color: [palette.cyan, palette.purple, palette.emerald, palette.orange][bi] } })))];
            const links = vars.brand.flatMap((b, bi) => {
              const base = share((i) => data[i].brand === b) * data.length;
              const vals = funnel[bi].map((f) => Math.round(f * base));
              return [{ source: 'All respondents', target: `${b} · Aware`, value: vals[0] }, ...[1, 2, 3].map((k) => ({ source: `${b} · ${stages[k - 1]}`, target: `${b} · ${stages[k]}`, value: Math.max(1, vals[k]) }))];
            });
            return { tooltip: { trigger: 'item' }, series: [{ type: 'sankey', left: 4, right: 130, nodeWidth: 10, nodeGap: 6, layoutIterations: 0, emphasis: { focus: 'adjacency' }, label: { color: t === 'dark' ? '#ECF1FF' : '#0C142E', fontSize: 10 }, lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 }, data: nodes, links }] };
          }} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Distribution" title="NPS score distribution" />
          <EChart ariaLabel="NPS distribution" height={300} deps={[weighted]} option={(t) => ({
            tooltip: { trigger: 'axis', valueFormatter: (v) => fmtPct(Number(v)) }, grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: Array.from({ length: 11 }, (_, i) => String(i)), ...axis(t), splitLine: { show: false } },
            yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
            series: [{ type: 'bar', barWidth: '70%', data: Array.from({ length: 11 }, (_, s) => ({ value: share((i) => data[i].nps === s), itemStyle: { borderRadius: [4, 4, 0, 0], color: s <= 6 ? palette.danger : s <= 8 ? palette.warn : palette.emerald } })) }],
          })} />
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader eyebrow="Trend" title="Consideration by brand across 8 waves" />
          <EChart ariaLabel="Consideration trend by brand" height={260} deps={[weighted]} option={(t) => ({
            tooltip: { trigger: 'axis', valueFormatter: (v) => fmtPct(Number(v)) }, legend: { right: 0 },
            xAxis: { type: 'category', data: Array.from({ length: 8 }, (_, i) => `W${i + 1}`), boundaryGap: false, ...axis(t), splitLine: { show: false } },
            yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
            series: vars.brand.map((b) => ({ name: b, type: 'line', smooth: true, symbolSize: 5, data: Array.from({ length: 8 }, (_, wv) => +(share((i) => data[i].brand === b && data[i].wave === wv && data[i].consider === 1) / Math.max(1e-9, share((i) => data[i].brand === b && data[i].wave === wv))).toFixed(3)) })),
          })} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Narrative" title="Executive summary" actions={<Badge tone="purple"><Sparkles size={10} /> AI-assisted draft</Badge>} />
          <motion.textarea key={String(weighted) + row + col + metric} initial={{ opacity: 0 }} animate={{ opacity: 1 }} value={narrative ?? draft} onChange={(e) => setNarrative(e.target.value)} rows={9} className={cn(inputCls, 'h-auto py-3 leading-relaxed')} aria-label="Editable narrative" />
          <div className="mt-2 flex items-center justify-between text-2xs text-ink-3"><span>Template-generated from {DATASET.id} v{DATASET.version} (validated {DATASET.validated}). Editable.</span>{narrative !== null && <button className="text-cyan" onClick={() => setNarrative(null)}>Reset</button>}</div>
        </Panel>
      </div>
    </div>
  );
}

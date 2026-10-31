'use client';
/**
 * Flow (Sankey), fieldwork trend and segmentation over a survey's recorded completes. Uses the
 * same filters as the results tables (flagged in/out, weighted) and the API's /explore view.
 */
import { useMemo, useState } from 'react';
import type { Flow, Segmentation, Trend } from '@/lib/core';
import { useLive } from '@/lib/live';
import { palette } from '@/lib/tokens';
import { fmtNum, fmtPct } from '@/lib/utils';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, EmptyState, Field, inputCls, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';

type Attempt<T> = { ok: true; data: T } | { ok: false; error: string };
type Explore = {
  base: number; weighted: boolean;
  options: { flow: { id: string; text: string }[]; segmentation: { id: string; label: string }[]; trend: { id: string; text: string; type: string; options: { code: string; label: string }[] }[] };
  flow: Attempt<Flow>; trend: Attempt<Trend>; segments: Attempt<Segmentation>;
};

const segColors = [palette.blue, palette.cyan, palette.purple, palette.emerald, palette.orange, palette.danger];
const short = (t: string, n = 38) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const Unavailable = ({ error }: { error: string }) => <EmptyState title="Not available for this survey" body={error} />;

export function ExploreViews({ sid, filters, tick }: { sid: string; filters: { excludeFlagged: boolean; weighted: boolean }; tick: number }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [trendQ, setTrendQ] = useState('');
  const [trendCode, setTrendCode] = useState('');
  const [interval, setInterval] = useState<'' | 'day' | 'week'>('');
  const [k, setK] = useState(3);
  const qs = new URLSearchParams({ excludeFlagged: String(filters.excludeFlagged), weighted: String(filters.weighted), k: String(k), ...(from && { from }), ...(to && { to }), ...(trendQ && { trendQ }), ...(trendQ && trendCode && { trendCode }), ...(interval && { interval }) }).toString();
  const ex = useLive<Explore>(`/surveys/${sid}/explore?${qs}`, [sid, qs, tick]);
  const e = ex.data;
  const trendOpt = useMemo(() => e?.options.trend.find((q) => q.id === trendQ), [e, trendQ]);
  if (!e) return null;
  if (!e.base) return null;
  const flow = e.flow.ok ? e.flow.data : null;
  const trend = e.trend.ok ? e.trend.data : null;
  const seg = e.segments.ok ? e.segments.data : null;
  const fmtMetric = (v: number | null) => (v === null || !trend?.metric ? '—' : trend.metric.kind === 'share' ? fmtPct(v, 0) : trend.metric.kind === 'nps' ? `${v > 0 ? '+' : ''}${v}` : fmtNum(v, 1));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel className="xl:col-span-2">
        <PanelHeader eyebrow={`Respondent flow · base ${fmtNum(flow?.base ?? 0)}${e.weighted ? ' (weighted)' : ''}`} title={flow ? `${flow.from.id} → ${flow.to.id}: how answers to one question carry into another` : 'Respondent flow'}
          info="Each band is the respondents who gave that pair of answers. NPS is grouped into promoters, passives and detractors." />
        <div className="mb-3 flex flex-wrap gap-3">
          <div className="w-64"><Field label="From"><select aria-label="Flow from" className={inputCls} value={from || flow?.from.id || ''} onChange={(ev) => setFrom(ev.target.value)}>{e.options.flow.map((q) => <option key={q.id} value={q.id}>{q.id}: {short(q.text)}</option>)}</select></Field></div>
          <div className="w-64"><Field label="To"><select aria-label="Flow to" className={inputCls} value={to || flow?.to.id || ''} onChange={(ev) => setTo(ev.target.value)}>{e.options.flow.map((q) => <option key={q.id} value={q.id}>{q.id}: {short(q.text)}</option>)}</select></Field></div>
        </div>
        {flow ? (
          <EChart ariaLabel="Respondent flow sankey" height={320} deps={[flow]} option={(t) => ({
            tooltip: { trigger: 'item', formatter: (raw: unknown) => { const p = raw as { dataType?: string; data: { source?: string; target?: string; value: number; pctOfFrom?: number; name?: string } }; return p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}<br/>${fmtNum(p.data.value, 0)} (${fmtPct(p.data.pctOfFrom ?? 0, 0)} of ${String(p.data.source).split(': ')[1]})` : `${p.data.name}: ${fmtNum(p.data.value, 0)}`; } },
            series: [{
              type: 'sankey', left: 4, right: 150, nodeWidth: 10, nodeGap: 8, layoutIterations: 0, emphasis: { focus: 'adjacency' },
              label: { color: t === 'dark' ? '#ECF1FF' : '#0C142E', fontSize: 10 }, lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 },
              data: flow.nodes.map((n, i) => ({ name: n.name, value: n.value, itemStyle: { color: n.side === 'from' ? segColors[i % segColors.length] : n.code === 'det' ? palette.danger : n.code === 'pro' ? palette.emerald : n.code === 'pas' ? palette.warn : palette.cyan } })),
              links: flow.links,
            }],
          })} />
        ) : <Unavailable error={(e.flow as { error: string }).error} />}
      </Panel>

      <Panel>
        <PanelHeader eyebrow={`Fieldwork trend${trend ? ` · by ${trend.interval}` : ''}`} title={trend?.metric ? `${trend.metric.label} for ${trend.metric.questionId}, with completes` : 'Completes over fieldwork'}
          info="Dated by when each interview was completed. Periods with few completes swing more; check the base in the tooltip." />
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-56"><Field label="Metric"><select aria-label="Trend metric" className={inputCls} value={trendQ} onChange={(ev) => { setTrendQ(ev.target.value); setTrendCode(e.options.trend.find((q) => q.id === ev.target.value)?.options[0]?.code ?? ''); }}>
            <option value="">Completes only</option>{e.options.trend.map((q) => <option key={q.id} value={q.id}>{q.id}: {short(q.text, 30)}</option>)}</select></Field></div>
          {trendOpt && (trendOpt.type === 'single' || trendOpt.type === 'multi') && <div className="w-44"><Field label="Answer"><select aria-label="Trend answer" className={inputCls} value={trendCode} onChange={(ev) => setTrendCode(ev.target.value)}>{trendOpt.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field></div>}
          <Segmented size="sm" label="Trend interval" value={interval || trend?.interval || 'day'} onChange={(v) => setInterval(v as 'day' | 'week')} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }]} />
        </div>
        {trend ? (
          <EChart ariaLabel="Fieldwork trend" height={260} deps={[trend]} option={(t) => ({
            tooltip: { trigger: 'axis', formatter: (raw: unknown) => { const p = trend.points[(raw as { dataIndex: number }[])[0].dataIndex]; return `${p.period}<br/>Completes: ${p.completes}${trend.metric ? `<br/>${trend.metric.label}: ${fmtMetric(p.value)} (base ${fmtNum(p.base, 0)})` : ''}`; } },
            grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: trend.points.map((p) => p.period.slice(5)), ...axis(t), splitLine: { show: false } },
            yAxis: [{ type: 'value', name: 'Completes', nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t) }, ...(trend.metric ? [{ type: 'value' as const, name: trend.metric.label, nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t), splitLine: { show: false }, axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => (trend.metric!.kind === 'share' ? `${Math.round(v * 100)}%` : String(v)) } }] : [])],
            series: [
              { name: 'Completes', type: 'bar', barMaxWidth: 14, itemStyle: { color: palette.blue, opacity: 0.45, borderRadius: [3, 3, 0, 0] }, data: trend.points.map((p) => p.completes) },
              ...(trend.metric ? [{ name: trend.metric.label, type: 'line' as const, yAxisIndex: 1, connectNulls: false, smooth: true, symbolSize: 4, itemStyle: { color: palette.cyan }, data: trend.points.map((p) => p.value) }] : []),
            ],
          })} />
        ) : <Unavailable error={(e.trend as { error: string }).error} />}
      </Panel>

      <Panel>
        <PanelHeader eyebrow={seg ? `Segmentation · k-means on ${seg.variables.length} scale questions · base ${fmtNum(seg.base)}` : 'Segmentation'} title="Attitudinal segments from the answers"
          info="Respondents are grouped by their standardised answers to rating, NPS and numeric questions. The map shows the first two principal components. Segments are a starting point for analysis, not a validated typology."
          actions={<Segmented size="sm" label="Number of segments" value={String(k)} onChange={(v) => setK(Number(v))} options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: `k=${n}` }))} />} />
        {seg ? (
          <>
            <EChart ariaLabel="Segment map" height={260} deps={[seg]} option={(t) => ({
              tooltip: { trigger: 'item' }, legend: { top: 'bottom', left: 'center', textStyle: { fontSize: 10 } }, grid: { left: 8, right: 8, top: 28, bottom: 44, containLabel: true },
              xAxis: { type: 'value', name: `PC1 (${fmtPct(seg.map.explained[0] ?? 0, 0)})`, nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t) },
              yAxis: { type: 'value', name: `PC2 (${fmtPct(seg.map.explained[1] ?? 0, 0)})`, nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t) },
              series: seg.segments.map((s) => ({ name: s.name, type: 'scatter', symbolSize: 4, itemStyle: { color: segColors[s.id], opacity: 0.7 }, data: seg.map.points.filter((p) => p.segment === s.id).map((p) => [p.x, p.y]) })),
            })} />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{seg.segments.map((s) => (
              <div key={s.id} className="panel-solid p-2.5 text-[12px]">
                <div className="flex items-center gap-1.5 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: segColors[s.id] }} />{s.name}<span className="num ml-auto text-2xs text-ink-3">{fmtPct(s.share, 0)} · n={fmtNum(s.size, 0)}</span></div>
                <ul className="mt-1 space-y-0.5 text-2xs text-ink-2">{s.distinct.map((d) => {
                  const v = seg.variables.find((x) => x.id === d.id)!;
                  return <li key={d.id}>{d.diff > 0 ? 'Higher' : 'Lower'} on {d.id} ({short(v.label, 34)}): {fmtNum(s.means[d.id], 1)} vs {fmtNum(v.mean, 1)}</li>;
                })}</ul>
              </div>
            ))}</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-2xs"><Badge tone="blue">Segments explain {fmtPct(seg.quality.betweenShare, 0)} of answer variance</Badge>{seg.excluded > 0 && <Badge tone="orange">{seg.excluded} left out (missing an answer)</Badge>}</div>
          </>
        ) : <Unavailable error={(e.segments as { error: string }).error} />}
      </Panel>
    </div>
  );
}

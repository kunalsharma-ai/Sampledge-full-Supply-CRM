'use client';
/**
 * Screen 22 · Survey Routing Intelligence. A left-to-right graph of how respondents move:
 * panel entry → eligibility checks → router (strategy) → live surveys (quota state) → outcomes.
 * Edge width is flow per hour. "Replay a path" walks one respondent through the graph.
 * Switching strategy re-weights the router and the whole graph updates. A table under the graph
 * carries the same numbers for screen readers and for copying.
 * Integration: SAMPLEON router `GET /sampleon/v1/routing/flows?window=1h` (planned).
 */
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle2, Filter, GitBranch, LogIn, Play, Square, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Panel, Segmented } from '@/components/ui/primitives';
import { fmt, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { panelBrands } from '@/lib/supply/demo';
import { pace, paceBand, paceMeta, surveys } from '@/lib/supply/fieldwork';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtMoney, fmtNum, rng } from '@/lib/utils';

const screen = screenBySlug('routing')!;
type Strategy = 'yield' | 'fill' | 'balanced';
type Kind = 'entry' | 'check' | 'router' | 'survey' | 'outcome';
type RData = { kind: Kind; title: string; sub?: string; metric: string; color?: string; state?: 'on' | 'dim' | 'normal'; band?: keyof typeof paceMeta; lines?: [string, string][] };

const icons: Record<Kind, typeof Users> = { entry: LogIn, check: Filter, router: GitBranch, survey: Square, outcome: CheckCircle2 };
function RNode({ data }: NodeProps<Node<RData>>) {
  const I = icons[data.kind];
  return (
    <div className={cn('w-[200px] rounded-2xl border bg-surface/95 px-3 py-2.5 shadow-panel backdrop-blur transition-all duration-300',
      data.state === 'on' ? 'border-primary shadow-glow' : 'hairline', data.state === 'dim' && 'opacity-35')}>
      {data.kind !== 'entry' && <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-3" />}
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        {data.color ? <span className="h-2 w-2 rounded-full" style={{ background: data.color }} /> : <I size={11} />}{data.kind}
        {data.band && <span className={cn('ml-auto normal-case tracking-normal', paceMeta[data.band].text)}>{paceMeta[data.band].label}</span>}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] font-semibold text-ink">{data.title}</div>
      {data.lines && <ul className="my-1 space-y-0.5">{data.lines.map(([k, v]) => <li key={k} className="flex justify-between text-[10.5px]"><span className="text-ink-2">{k}</span><span className="num text-ink-3">{v}</span></li>)}</ul>}
      <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[10.5px] text-ink-3">{data.sub}</span><span className="num text-[12px] font-bold text-ink">{data.metric}</span></div>
      {data.kind !== 'outcome' && <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-primary" />}
    </div>
  );
}
const nodeTypes = { r: RNode };

const live = surveys.filter((s) => s.status === 'live').slice(0, 6);
const entryRate: Record<string, number> = { t2o: 520, mfr: 410, mho: 90 };
const checks = [{ id: 'fraud', title: 'Fraud & device', pass: 0.94 }, { id: 'profile', title: 'Profile & country match', pass: 0.71 }, { id: 'fatigue', title: 'Fatigue window', pass: 0.88 }];

function model(strategy: Strategy) {
  const entering = Object.values(entryRate).reduce((a, b) => a + b, 0);
  let flow = entering;
  const checkFlows = checks.map((c) => { const inF = flow; flow = Math.round(flow * c.pass); return { ...c, in: inF, out: flow, rejected: inF - flow }; });
  const routed = flow;
  const weights = live.map((s) => {
    const p = pace(s.completes, s.target, s.elapsed);
    const epc = s.cpi * s.ir;
    return strategy === 'yield' ? epc : strategy === 'fill' ? Math.max(0.05, 1.4 - p) : Math.sqrt(epc) * Math.max(0.2, 1.3 - p);
  });
  const wsum = weights.reduce((a, b) => a + b, 0);
  const rows = live.map((s, i) => {
    const inF = Math.round((routed * weights[i]) / wsum);
    const full = s.quotas.filter((q) => q.hard && (q.achieved >= q.target * 0.9 || pace(q.achieved, q.target, s.elapsed) > 1.15)).length / Math.max(1, s.quotas.length);
    const overquota = Math.round(inF * full * 0.25);
    const completes = Math.round((inF - overquota) * s.ir * (1 - s.dropoff));
    const rejected = Math.round(completes * (1 - s.quality) * 0.35);
    return { s, in: inF, overquota, completes: completes - rejected, rejected, screenout: inF - overquota - completes, share: weights[i] / wsum, epc: s.cpi * s.ir, band: paceBand(s.completes, s.target, s.elapsed) };
  });
  const sum = (k: 'completes' | 'screenout' | 'overquota' | 'rejected') => rows.reduce((a, r) => a + r[k], 0);
  return { entering, checkFlows, routed, rows, outcomes: { complete: sum('completes'), screenout: sum('screenout'), overquota: sum('overquota'), quality: sum('rejected') }, revenue: rows.reduce((a, r) => a + r.completes * r.s.cpi, 0) };
}

const X = { entry: 0, check: 250, router: 500, survey: 750, outcome: 1030 };
const outcomeMeta = [
  { id: 'complete', title: 'Complete', color: 'rgb(var(--emerald))' }, { id: 'screenout', title: 'Screen-out', color: 'rgb(var(--ink-3))' },
  { id: 'overquota', title: 'Over quota', color: 'rgb(var(--orange))' }, { id: 'quality', title: 'Quality reject', color: 'rgb(var(--danger))' },
] as const;

function Graph() {
  const reduced = useOS((s) => s.motion === 'reduced');
  const [strategy, setStrategy] = useState<Strategy>('balanced');
  const [path, setPath] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const m = useMemo(() => model(strategy), [strategy]);
  const maxFlow = m.entering;
  const w = (f: number) => 1 + (f / maxFlow) * 14;

  const replay = () => {
    const r = rng(Date.now() % 100000);
    const entry = r() < 0.5 ? 't2o' : r() < 0.85 ? 'mfr' : 'mho';
    const row = m.rows[Math.floor(r() * m.rows.length)];
    const out = r() < row.s.ir ? 'complete' : r() < 0.15 ? 'overquota' : 'screenout';
    const p = [`e-${entry}`, 'checks', 'router', `s-${row.s.id}`, `o-${out}`];
    if (timer.current) clearInterval(timer.current);
    setPath(p);
    if (reduced) { setStep(p.length); return; }
    setStep(1);
    timer.current = setInterval(() => setStep((s) => { if (s >= p.length) { clearInterval(timer.current!); return s; } return s + 1; }), 550);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const lit = new Set(path.slice(0, step));
  const state = (id: string): RData['state'] => (path.length ? (lit.has(id) ? 'on' : 'dim') : 'normal');

  const nodes: Node<RData>[] = [
    ...panelBrands.map((b, i) => ({ id: `e-${b.id}`, type: 'r', position: { x: X.entry, y: 60 + i * 120 }, data: { kind: 'entry' as const, title: b.name, sub: 'entering / h', metric: fmtNum(entryRate[b.id]), color: b.color, state: state(`e-${b.id}`) } })),
    { id: 'checks', type: 'r', position: { x: X.check, y: 150 }, data: { kind: 'check', title: 'Eligibility checks', lines: m.checkFlows.map((c) => [c.title, `${Math.round(c.pass * 100)}% pass`] as [string, string]), sub: 'eligible / h', metric: fmtNum(m.routed), state: state('checks') } },
    { id: 'router', type: 'r', position: { x: X.router, y: 175 }, data: { kind: 'router', title: { yield: 'Highest earnings', fill: 'Fill slowest quotas', balanced: 'Balanced' }[strategy], sub: 'routed / h', metric: fmtNum(m.routed), state: state('router') } },
    ...m.rows.map((r, i) => ({ id: `s-${r.s.id}`, type: 'r', position: { x: X.survey, y: i * 78 }, data: { kind: 'survey' as const, title: r.s.title, sub: `${Math.round(r.share * 100)}% · EPC ${fmt.money(r.epc)}`, metric: fmtNum(r.in), band: r.band, state: state(`s-${r.s.id}`) } })),
    ...outcomeMeta.map((o, i) => ({ id: `o-${o.id}`, type: 'r', position: { x: X.outcome, y: 30 + i * 110 }, data: { kind: 'outcome' as const, title: o.title, sub: 'per hour', metric: fmtNum(m.outcomes[o.id]), color: o.color, state: state(`o-${o.id}`) } })),
  ];
  const edge = (source: string, target: string, flow: number, color = 'rgb(var(--ink-3) / .45)'): Edge => {
    const on = lit.has(source) && lit.has(target) && path.indexOf(target) === path.indexOf(source) + 1;
    return { id: `${source}>${target}`, source, target, animated: on, style: { stroke: on ? 'rgb(var(--primary))' : color, strokeWidth: on ? Math.max(3, w(flow)) : w(flow), opacity: path.length && !on ? 0.25 : 1, transition: 'opacity .3s' } };
  };
  const edges: Edge[] = [
    ...panelBrands.map((b) => edge(`e-${b.id}`, 'checks', entryRate[b.id], `color-mix(in srgb, ${b.color} 55%, transparent)`)),
    edge('checks', 'router', m.routed),
    ...m.rows.map((r) => edge('router', `s-${r.s.id}`, r.in)),
    ...m.rows.flatMap((r) => [
      edge(`s-${r.s.id}`, 'o-complete', r.completes, 'rgb(var(--emerald) / .5)'), edge(`s-${r.s.id}`, 'o-screenout', r.screenout),
      ...(r.overquota ? [edge(`s-${r.s.id}`, 'o-overquota', r.overquota, 'rgb(var(--orange) / .5)')] : []),
      ...(r.rejected ? [edge(`s-${r.s.id}`, 'o-quality', r.rejected, 'rgb(var(--danger) / .45)')] : []),
    ]),
  ];
  const selRow = m.rows.find((r) => `s-${r.s.id}` === sel);
  const selChecks = sel === 'checks';

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Survey routing" subtitle="How respondents move from each panel, through eligibility checks, into live surveys, and what happens to them there. Line width is people per hour."
        actions={<>
          <Segmented label="Routing strategy" size="sm" value={strategy} onChange={(v) => { setStrategy(v); setPath([]); }} options={[{ value: 'yield', label: 'Highest earnings' }, { value: 'balanced', label: 'Balanced' }, { value: 'fill', label: 'Fill slowest quotas' }]} />
          <Button size="sm" onClick={replay}><Play size={13} /> Replay a path</Button>
          {path.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setPath([]); if (timer.current) clearInterval(timer.current); }}>Clear</Button>}
        </>} />

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <Panel className="h-[480px] overflow-hidden p-0">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.06 }} minZoom={0.3} maxZoom={1.6}
            nodesConnectable={false} nodesDraggable={false} elementsSelectable onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)} proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ink-3) / .25)" />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="This strategy, per hour" title={fmtMoney(m.revenue)} actions={<Badge tone="neutral">revenue</Badge>} />
            <dl className="grid grid-cols-2 gap-2 text-center text-[12.5px]">
              {outcomeMeta.map((o) => <div key={o.id} className="rounded-lg bg-surface-2/40 p-2"><dt className="flex items-center justify-center gap-1 text-2xs text-ink-3"><span className="h-2 w-2 rounded-full" style={{ background: o.color }} />{o.title}</dt><dd className="num font-semibold">{fmtNum(m.outcomes[o.id])}</dd></div>)}
            </dl>
            <p className="mt-2 text-2xs text-ink-3">Conversion from routed to complete: <b className="num text-ink">{((m.outcomes.complete / m.routed) * 100).toFixed(1)}%</b></p>
          </Panel>
          <Panel className="p-4">
            {selRow ? (<>
              <SectionTitle eyebrow="Survey" title={selRow.s.title} />
              <ul className="space-y-1 text-[12.5px]">
                {[['Routed in', fmtNum(selRow.in)], ['Completes', fmtNum(selRow.completes)], ['Screen-outs', fmtNum(selRow.screenout)], ['Over quota', fmtNum(selRow.overquota)], ['Pace', paceMeta[selRow.band].label], ['Earnings per click', fmt.money(selRow.epc)]].map(([k, v]) => <li key={k} className="flex justify-between"><span className="text-ink-3">{k}</span><span className="num font-semibold">{v}</span></li>)}
              </ul>
            </>) : selChecks ? (<>
              <SectionTitle eyebrow="Eligibility checks, in order" title={`${fmtNum(m.entering - m.routed)} stopped per hour`} />
              <ul className="space-y-1 text-[12.5px]">{m.checkFlows.map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="text-ink-3">{c.title}</span><span className="num font-semibold">{fmtNum(c.in)} → {fmtNum(c.out)}</span></li>)}</ul>
            </>) : (<>
              <SectionTitle eyebrow="How the router decides" title="Strategies" />
              <ul className="space-y-2 text-2xs text-ink-2">
                <li><b className="text-ink">Highest earnings</b> sends people where CPI × incidence is highest.</li>
                <li><b className="text-ink">Fill slowest quotas</b> favours surveys furthest behind pace.</li>
                <li><b className="text-ink">Balanced</b> weighs both. Click any node for its numbers.</li>
              </ul>
            </>)}
          </Panel>
        </div>
      </div>

      <Panel className="p-4">
        <SectionTitle eyebrow="Same data as the graph" title="Flows per hour by survey" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <caption className="sr-only">Routing flows per hour for each live survey under the {strategy} strategy</caption>
            <thead><tr className="text-left text-2xs text-ink-3">{['Survey', 'Share', 'Routed in', 'Completes', 'Screen-outs', 'Over quota', 'Quality rejects', 'Pace'].map((h) => <th key={h} scope="col" className="py-1.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{m.rows.map((r) => (
              <tr key={r.s.id} className="border-t hairline"><th scope="row" className="py-1.5 text-left font-medium">{r.s.title}</th><td className="num">{Math.round(r.share * 100)}%</td><td className="num">{fmtNum(r.in)}</td><td className="num">{fmtNum(r.completes)}</td><td className="num">{fmtNum(r.screenout)}</td><td className="num">{fmtNum(r.overquota)}</td><td className="num">{fmtNum(r.rejected)}</td><td className={cn('text-2xs font-semibold', paceMeta[r.band].text)}>{paceMeta[r.band].label}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function Routing() { return <ReactFlowProvider><Graph /></ReactFlowProvider>; }

'use client';
/**
 * Screen 26 · Engagement Automation Builder. Workflow list on the left, node canvas in the middle,
 * inspector on the right, execution log underneath. Add blocks from the palette, connect handles
 * (conditions have yes and no outputs), and test-run with a sample member to watch the path light
 * up step by step. Activating a workflow asks for confirmation because it messages real members.
 * Integration: workflows save to `PUT /automation/workflows/:id` (planned) and run through the
 * existing agent runner, whose runs feed the log.
 */
import {
  addEdge, Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Clock3, FlaskConical, GitBranch, Play, Plus, Power, Trash2, Undo2, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Field, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { blockLabel, blocks, runLogs, workflows as seed, type WfKind, type WfNode, type Workflow } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('automation')!;
const kindMeta: Record<WfKind, { icon: typeof Zap; cls: string; label: string }> = {
  trigger: { icon: Zap, cls: 'text-orange bg-orange/12', label: 'Trigger' },
  condition: { icon: GitBranch, cls: 'text-purple bg-purple/12', label: 'Condition' },
  delay: { icon: Clock3, cls: 'text-cyan bg-cyan/12', label: 'Delay' },
  action: { icon: Play, cls: 'text-emerald bg-emerald/12', label: 'Action' },
};
type ND = { node: WfNode; state: 'idle' | 'run' | 'done' | 'skip' };

function summary(n: WfNode) {
  const c = n.config;
  if (n.type === 'wait') return `${c.hours ?? 0} hours`;
  if (n.type === 'window') return `from ${c.from ?? 9}:00 local`;
  if (n.type === 'inactive') return `${c.days} days without activity`;
  if (n.type === 'profile_gap') return `below ${c.pct}%`;
  if (n.type === 'points') return `${fmtNum(Number(c.points))} pts`;
  if (n.type === 'bonus') return `+${c.points} pts`;
  return Object.values(c).filter(Boolean).join(' · ') || 'Not configured';
}

function WfNodeView({ data, selected }: NodeProps<Node<ND>>) {
  const { node, state } = data;
  const m = kindMeta[node.kind];
  const I = m.icon;
  return (
    <div className={cn('w-[210px] rounded-2xl border bg-surface/95 p-3 shadow-panel backdrop-blur transition-all duration-300',
      selected ? 'border-focus' : 'hairline', state === 'run' && 'scale-[1.03] border-primary shadow-glow', state === 'done' && 'border-emerald/60', state === 'skip' && 'opacity-40')}>
      {node.kind !== 'trigger' && <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-0 !bg-ink-3" />}
      <div className="flex items-center gap-2">
        <span className={cn('grid h-6 w-6 place-items-center rounded-lg', m.cls)}><I size={13} /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{m.label}</span>
      </div>
      <div className="mt-1.5 text-[12.5px] font-semibold text-ink">{blockLabel(node.kind, node.type)}</div>
      <div className="truncate text-[11px] text-ink-2">{summary(node)}</div>
      {node.kind === 'condition' ? (<>
        <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '28%' }} className="!h-2.5 !w-2.5 !border-0 !bg-emerald" />
        <Handle id="no" type="source" position={Position.Bottom} style={{ left: '72%' }} className="!h-2.5 !w-2.5 !border-0 !bg-danger" />
        <span className="absolute -bottom-4 left-[19%] text-[9px] font-bold text-emerald">YES</span><span className="absolute -bottom-4 left-[65%] text-[9px] font-bold text-danger">NO</span>
      </>) : <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-primary" />}
    </div>
  );
}
const nodeTypes = { wf: WfNodeView };

const toNodes = (w: Workflow): Node<ND>[] => w.nodes.map((n) => ({ id: n.id, type: 'wf', position: { x: n.x, y: n.y }, data: { node: n, state: 'idle' } }));
const edgeStyle = (branch?: string) => ({ stroke: branch === 'yes' ? 'rgb(var(--emerald))' : branch === 'no' ? 'rgb(var(--danger))' : 'rgb(var(--ink-3) / .7)', strokeWidth: 1.8 });
const toEdges = (w: Workflow): Edge[] => w.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.branch, style: edgeStyle(e.branch) }));

function Builder() {
  const toast = useOS((s) => s.toast);
  const reduced = useOS((s) => s.motion === 'reduced');
  const [list, setList] = useState(seed);
  const [wid, setWid] = useState(seed[0].id);
  const wf = list.find((w) => w.id === wid)!;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ND>>(toNodes(wf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(wf));
  const [selId, setSelId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ nodes: Node<ND>[]; edges: Edge[] }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'activate' | 'pause' | null>(null);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => { setNodes(toNodes(wf)); setEdges(toEdges(wf)); setSelId(null); setHistory([]); setDirty(false); }, [wid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const snapshot = () => { setHistory((h) => [...h.slice(-29), { nodes, edges }]); setDirty(true); };
  const sel = nodes.find((n) => n.id === selId);
  const def = sel && blocks[sel.data.node.kind].find((b) => b.type === sel.data.node.type);

  const addBlock = (kind: WfKind, type: string) => {
    snapshot();
    const id = `${kind[0]}${Date.now().toString(36).slice(-4)}`;
    const maxY = Math.max(0, ...nodes.map((n) => n.position.y));
    const anchorX = sel ? sel.position.x : (nodes[0]?.position.x ?? 0);
    const defaults = Object.fromEntries((blocks[kind].find((b) => b.type === type)?.fields ?? []).map((f) => [f.key, f.kind === 'number' ? (f.unit === 'hours' ? 24 : f.unit === 'pts' ? 50 : 30) : f.options?.[0] ?? '']));
    const node: WfNode = { id, kind, type, config: defaults, x: anchorX, y: maxY + 115 };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'wf', position: { x: node.x, y: node.y }, data: { node, state: 'idle' }, selected: true }]);
    if (selId && sel?.data.node.kind !== 'condition') setEdges((es) => addEdge({ id: `e${id}`, source: selId, target: id, style: edgeStyle() }, es));
    setSelId(id);
  };
  const setConfig = (key: string, v: string | number) => {
    if (!sel) return;
    setDirty(true);
    setNodes((ns) => ns.map((n) => (n.id === sel.id ? { ...n, data: { ...n.data, node: { ...n.data.node, config: { ...n.data.node.config, [key]: v } } } } : n)));
  };
  const onConnect = (c: Connection) => {
    if (c.source === c.target) return;
    snapshot();
    setEdges((es) => addEdge({ ...c, id: `e${Date.now()}`, style: edgeStyle(c.sourceHandle ?? undefined) }, es));
  };
  const remove = () => { if (!sel || sel.data.node.kind === 'trigger') return; snapshot(); setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelId(null); };
  const undo = () => { const last = history[history.length - 1]; if (!last) return; setNodes(last.nodes); setEdges(last.edges); setHistory((h) => h.slice(0, -1)); };
  const save = () => {
    setList((l) => l.map((w) => (w.id === wf.id ? { ...w, nodes: nodes.map((n) => ({ ...n.data.node, x: n.position.x, y: n.position.y })), edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, branch: (e.sourceHandle as 'yes' | 'no' | null) ?? undefined })) } : w)));
    setDirty(false); toast(`${wf.name} saved as draft changes`, 'ok');
  };

  /** Walk the graph from the trigger, taking "yes" at the first condition and "no" at later ones. */
  const testRun = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    const trig = nodes.find((n) => n.data.node.kind === 'trigger');
    if (!trig) return;
    const path: string[] = [trig.id];
    let cur = trig.id, conds = 0;
    for (let i = 0; i < 20; i++) {
      const outs = edges.filter((e) => e.source === cur);
      if (!outs.length) break;
      const curNode = nodes.find((n) => n.id === cur)!;
      const next = curNode.data.node.kind === 'condition' ? (outs.find((e) => e.sourceHandle === (conds++ === 0 ? 'yes' : 'no')) ?? outs[0]) : outs[0];
      cur = next.target; path.push(cur);
    }
    const mark = (k: number) => setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, state: path.indexOf(n.id) === -1 ? (k >= path.length ? 'skip' : 'idle') : path.indexOf(n.id) < k ? 'done' : path.indexOf(n.id) === k ? 'run' : 'idle' } })));
    setRunning(true);
    if (reduced) { mark(path.length); setRunning(false); return; }
    path.forEach((_, k) => timers.current.push(setTimeout(() => mark(k), k * 650)));
    timers.current.push(setTimeout(() => { mark(path.length); setRunning(false); toast(`Test run finished: ${path.length} steps, no messages sent`, 'info'); }, path.length * 650));
    timers.current.push(setTimeout(() => setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, state: 'idle' } }))), path.length * 650 + 3500));
  };
  const logs = useMemo(() => runLogs.filter((l) => l.workflow === wf.id), [wf.id]);
  const issues = useMemo(() => {
    const out: string[] = [];
    const targets = new Set(edges.map((e) => e.target));
    nodes.forEach((n) => { if (n.data.node.kind !== 'trigger' && !targets.has(n.id)) out.push(`${blockLabel(n.data.node.kind, n.data.node.type)} is not connected`); });
    nodes.filter((n) => n.data.node.kind === 'condition').forEach((n) => { const hs = edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle); if (!hs.includes('yes') || !hs.includes('no')) out.push(`${blockLabel('condition', n.data.node.type)} needs both a yes and a no path`); });
    if (!nodes.some((n) => n.data.node.kind === 'action')) out.push('Add at least one action');
    return out;
  }, [nodes, edges]);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Automation builder" subtitle="Build engagement workflows from triggers, conditions, delays and actions. Test runs use a sample member and send nothing."
        actions={<>
          <Button size="sm" variant="ghost" disabled={!history.length} onClick={undo}><Undo2 size={13} /> Undo</Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={testRun}><FlaskConical size={13} /> Test run</Button>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={save}>Save</Button>
          {wf.status === 'active'
            ? <Button size="sm" variant="ghost" onClick={() => setConfirm('pause')}><Power size={13} /> Pause</Button>
            : <Button size="sm" disabled={issues.length > 0} onClick={() => setConfirm('activate')}><Power size={13} /> Activate</Button>}
        </>} />

      <div className="grid gap-4 xl:grid-cols-[230px_1fr]">
        <div className="space-y-4">
          <Panel className="p-3">
            <SectionTitle eyebrow="Workflows" title={`${list.length} workflows`} />
            <ul className="space-y-1">
              {list.map((w) => (
                <li key={w.id}><button onClick={() => setWid(w.id)} aria-current={w.id === wid ? 'true' : undefined} className={cn('w-full rounded-lg px-2.5 py-2 text-left', w.id === wid ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-2/50')}>
                  <span className="block truncate text-[12.5px] font-medium">{w.name}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-2xs text-ink-3"><StatusPill status={w.status === 'active' ? 'active' : w.status === 'paused' ? 'paused' : 'draft'} />{w.panel !== 'all' && <PanelChip panel={w.panel} short />}</span>
                </button></li>
              ))}
            </ul>
          </Panel>
          <Panel className="p-3">
            <SectionTitle eyebrow="Palette" title="Add a block" />
            <div className="space-y-2.5">
              {(Object.keys(blocks) as WfKind[]).filter((k) => k !== 'trigger').map((k) => (
                <div key={k}>
                  <div className="eyebrow mb-1">{kindMeta[k].label}s</div>
                  <div className="flex flex-wrap gap-1">{blocks[k].map((b) => <Button key={b.type} size="xs" variant="ghost" onClick={() => addBlock(k, b.type)} className="border hairline"><Plus size={11} /> {b.label}</Button>)}</div>
                </div>
              ))}
              <p className="text-2xs text-ink-3">New blocks attach after the selected block.</p>
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
        <Panel className="h-[540px] overflow-hidden p-0">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={(c) => { if (c.some((x) => x.type === 'remove')) snapshot(); onEdgesChange(c); }}
            onConnect={onConnect} onNodeClick={(_, n) => setSelId(n.id)} onPaneClick={() => setSelId(null)} onNodeDragStart={snapshot}
            fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.3} maxZoom={1.6} proOptions={{ hideAttribution: true }} deleteKeyCode={['Backspace', 'Delete']}>
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ink-3) / .25)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 90 }} nodeColor={(n) => ({ trigger: 'rgb(var(--orange))', condition: 'rgb(var(--purple))', delay: 'rgb(var(--cyan))', action: 'rgb(var(--emerald))' }[(n.data as ND).node.kind])} maskColor="rgb(var(--bg) / .6)" />
          </ReactFlow>
        </Panel>

          <div className="grid gap-4 md:grid-cols-2">
          <Panel className="p-4">
            {sel && def ? (<>
              <SectionTitle eyebrow={kindMeta[sel.data.node.kind].label} title={def.label} actions={sel.data.node.kind !== 'trigger' && <Button size="icon-sm" variant="ghost" aria-label="Delete block" onClick={remove}><Trash2 size={13} /></Button>} />
              <div className="space-y-3">
                {def.fields.length === 0 && <p className="text-2xs text-ink-3">No settings. Connect the yes and no outputs.</p>}
                {def.fields.map((f) => (
                  <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                    {f.kind === 'select'
                      ? <select className={inputCls} value={String(sel.data.node.config[f.key] ?? '')} onChange={(e) => setConfig(f.key, e.target.value)}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                      : <input className={inputCls} type={f.kind === 'number' ? 'number' : 'text'} value={sel.data.node.config[f.key] ?? ''} onChange={(e) => setConfig(f.key, f.kind === 'number' ? Number(e.target.value) : e.target.value)} />}
                  </Field>
                ))}
              </div>
            </>) : (<>
              <SectionTitle eyebrow="Workflow" title={wf.name} />
              <dl className="grid grid-cols-2 gap-2 text-center text-[12.5px]">
                <div className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">Runs, 7 days</dt><dd className="num font-semibold">{fmtNum(wf.runs7d)}</dd></div>
                <div className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">Converted</dt><dd className="num font-semibold">{Math.round(wf.conversion * 100)}%</dd></div>
              </dl>
              <p className="mt-3 text-2xs text-ink-3">Select a block to edit it. Drag from a block’s bottom handle to another block to connect. Backspace deletes the selected edge or block.</p>
            </>)}
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="Before activating" title={issues.length ? `${issues.length} to fix` : 'Ready'} actions={<Badge tone={issues.length ? 'warn' : 'emerald'}>{issues.length ? 'Blocked' : 'OK'}</Badge>} />
            <ul className="space-y-1 text-2xs text-ink-2">{issues.length ? issues.map((i) => <li key={i}>• {i}</li>) : <li>All blocks connected and every condition has both paths.</li>}</ul>
          </Panel>
        </div>
        </div>
      </div>

      <Panel className="p-4">
        <SectionTitle eyebrow="Execution log" title={logs.length ? `${logs.length} recent runs` : 'No runs yet'} />
        {logs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12.5px]">
              <caption className="sr-only">Recent runs of {wf.name}</caption>
              <thead><tr className="text-left text-2xs text-ink-3">{['Run', 'Member', 'When', 'Steps', 'Outcome', 'Note'].map((h) => <th key={h} scope="col" className="py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{logs.map((l) => (
                <tr key={l.id} className="border-t hairline"><td className="py-1.5 font-mono text-2xs">{l.id}</td><td>{l.member}</td><td className="text-ink-3">{l.at}</td><td className="num">{l.path.length}</td>
                  <td><StatusPill status={l.outcome === 'completed' ? 'completed' : l.outcome === 'waiting' ? 'scheduled' : l.outcome === 'failed' ? 'failed' : 'closed'} label={l.outcome} /></td><td className="text-ink-2">{l.note}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="py-6 text-center text-2xs text-ink-3">Runs appear here once the workflow is active.</p>}
      </Panel>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} tone={confirm === 'activate' ? 'primary' : 'danger'}
        title={confirm === 'activate' ? `Activate ${wf.name}?` : `Pause ${wf.name}?`}
        body={confirm === 'activate' ? 'Members who meet the trigger from now on will start receiving messages and points. Members already past the trigger are not included.' : 'Runs in progress stop at their next step. Nothing more is sent until you activate it again.'}
        confirmLabel={confirm === 'activate' ? 'Activate' : 'Pause'}
        onConfirm={() => { if (dirty) save(); setList((l) => l.map((w) => (w.id === wf.id ? { ...w, status: confirm === 'activate' ? 'active' : 'paused' } : w))); toast(`${wf.name} ${confirm === 'activate' ? 'activated' : 'paused'}`, confirm === 'activate' ? 'ok' : 'warn'); setConfirm(null); }} />
    </div>
  );
}

export default function Automation() { return <ReactFlowProvider><Builder /></ReactFlowProvider>; }

'use client';
/**
 * Screen 26 · Engagement Automation Builder. Workflow list on the left, node canvas in the middle,
 * inspector on the right, execution log underneath. Add blocks from the palette, connect handles
 * (conditions have yes and no outputs), and test-run with a sample member to watch the path light
 * up step by step. Activating a workflow asks for confirmation because it messages real members.
 * Live: workflows are `workflow` records (`/supply/records/workflow`), editable while draft or
 * paused. Activating is checked on the server (one trigger, every block connected, both condition
 * paths, supported blocks only) and the worker then enrols members who meet the trigger from that
 * moment and moves them through the graph once a minute. The test run asks the server for the path a
 * recent member would take today (`POST /supply/workflows/:id/test`), and the log is
 * `GET /supply/workflows/:id/runs`. "Opened last message" needs open tracking, so it stays demo only.
 */
import {
  addEdge, Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Clock3, FlaskConical, GitBranch, Play, Plus, Power, Trash2, Undo2, Zap } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useSupplyData } from '@/lib/supply/data';
import { ago, loadWorkflowRuns, records, testWorkflow, type Rec, type WorkflowData, type WorkflowRuns } from '@/lib/supply/live';
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
type ND = { node: WfNode; state: 'idle' | 'run' | 'done' | 'skip'; note?: string };
type LWorkflow = Workflow & { rec?: Rec<WorkflowData> };
const fromRec = (r: Rec<WorkflowData>): LWorkflow => ({ id: r.id, name: r.data.name, panel: r.data.panel, status: r.status as Workflow['status'], nodes: r.data.nodes ?? [], edges: r.data.edges ?? [], runs7d: 0, conversion: 0, rec: r });
const OPENED = '“Opened last message” needs open tracking from the delivery provider, which is not connected yet';

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
      {data.note && <div className="mt-1 truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium text-ink">{data.note}</div>}
      {node.kind === 'condition' ? (<>
        <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '28%' }} className="!h-2.5 !w-2.5 !border-0 !bg-emerald" />
        <Handle id="no" type="source" position={Position.Bottom} style={{ left: '72%' }} className="!h-2.5 !w-2.5 !border-0 !bg-danger" />
        <span className="absolute -bottom-4 left-[19%] text-[9px] font-bold text-emerald">YES</span><span className="absolute -bottom-4 left-[65%] text-[9px] font-bold text-danger">NO</span>
      </>) : <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-0 !bg-primary" />}
    </div>
  );
}
const nodeTypes = { wf: WfNodeView };

const toNodes = (w?: Workflow): Node<ND>[] => (w?.nodes ?? []).map((n) => ({ id: n.id, type: 'wf', position: { x: n.x, y: n.y }, data: { node: n, state: 'idle' } }));
const edgeStyle = (branch?: string) => ({ stroke: branch === 'yes' ? 'rgb(var(--emerald))' : branch === 'no' ? 'rgb(var(--danger))' : 'rgb(var(--ink-3) / .7)', strokeWidth: 1.8 });
const toEdges = (w?: Workflow): Edge[] => (w?.edges ?? []).map((e) => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.branch, style: edgeStyle(e.branch) }));

function Builder() {
  const toast = useOS((s) => s.toast);
  const reduced = useOS((s) => s.motion === 'reduced');
  const q = useSupplyData<LWorkflow[] | null>('automation:workflows', () => null, async () => (await records.list<WorkflowData>('workflow')).map(fromRec));
  const live = q.source === 'live' && q.data ? q.data : null;
  const [demoList, setList] = useState<LWorkflow[]>(seed);
  const list: LWorkflow[] = live ?? demoList;
  const [wid, setWid] = useState(seed[0].id);
  const wf: LWorkflow | undefined = list.find((w) => w.id === wid) ?? list[0];
  const [name, setName] = useState(wf?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<WorkflowRuns | null>(null);
  const fail = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : `Could not ${what}`, 'warn');
  const locked = !!live && wf?.status === 'active';
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ND>>(toNodes(wf));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(wf));
  const [selId, setSelId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ nodes: Node<ND>[]; edges: Edge[] }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'activate' | 'pause' | null>(null);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => { setNodes(toNodes(wf)); setEdges(toEdges(wf)); setSelId(null); setHistory([]); setDirty(false); setName(wf?.name ?? ''); }, [wf?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live || !wf) { setRuns(null); return; }
    let off = false;
    loadWorkflowRuns(wf.id).then((r) => { if (!off) setRuns(r); }).catch(() => { if (!off) setRuns(null); });
    return () => { off = true; };
  }, [live, wf?.id, wf?.rec?.version]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const node: WfNode = { id, kind, type, config: defaults, x: anchorX, y: maxY + 140 };
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
  const graph = (): Pick<WorkflowData, 'name' | 'nodes' | 'edges'> => ({
    name: name.trim() || wf!.name,
    nodes: nodes.map((n) => ({ ...n.data.node, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...(e.sourceHandle === 'yes' || e.sourceHandle === 'no' ? { branch: e.sourceHandle as 'yes' | 'no' } : {}) })),
  });
  /** Saves the canvas; live, returns the saved record (or null when the save failed). */
  const save = async (): Promise<Rec<WorkflowData> | null | undefined> => {
    if (!wf) return null;
    if (live && wf.rec) {
      setBusy(true);
      try { const r = await records.update<WorkflowData>('workflow', wf.rec, graph()); setDirty(false); toast(`${r.data.name} saved`, 'ok'); q.reload(); return r; } catch (e) { fail(e, 'save the workflow'); return null; } finally { setBusy(false); }
    }
    setList((l) => l.map((w) => (w.id === wf.id ? { ...w, ...graph() } : w)));
    setDirty(false); toast(`${name || wf.name} saved as draft changes`, 'ok');
    return undefined;
  };
  const create = async () => {
    const trigger: WfNode = { id: 't', kind: 'trigger', type: 'signup', config: { panel: 'Any' }, x: 0, y: 0 };
    const nm = `New workflow ${list.length + 1}`;
    if (live) {
      setBusy(true);
      try { const r = await records.create<WorkflowData>('workflow', { name: nm, panel: 'all', nodes: [trigger], edges: [] }); q.reload(); setWid(r.id); toast(`${r.ref} created as a draft`, 'ok'); } catch (e) { fail(e, 'create the workflow'); } finally { setBusy(false); }
      return;
    }
    const id = `wf-${Date.now().toString(36)}`;
    setList((l) => [...l, { id, name: nm, panel: 'all', status: 'draft', nodes: [trigger], edges: [], runs7d: 0, conversion: 0 }]);
    setWid(id);
  };
  const toggle = async (to: 'activate' | 'pause') => {
    if (!wf) return;
    if (live && wf.rec) {
      let rec: Rec<WorkflowData> | null | undefined = wf.rec;
      if (dirty && to === 'activate') rec = await save();
      if (!rec) return;
      setBusy(true);
      try { const r = await records.act<WorkflowData>('workflow', rec, to); toast(`${r.data.name} ${to === 'activate' ? 'activated' : 'paused'}`, to === 'activate' ? 'ok' : 'warn'); q.reload(); } catch (e) { fail(e, `${to} the workflow`); } finally { setBusy(false); }
      return;
    }
    if (dirty) await save();
    setList((l) => l.map((w) => (w.id === wf.id ? { ...w, status: to === 'activate' ? 'active' : 'paused' } : w)));
    toast(`${wf.name} ${to === 'activate' ? 'activated' : 'paused'}`, to === 'activate' ? 'ok' : 'warn');
  };

  /** Lights up the path step by step, with each step's note on its block. */
  const animate = (path: string[], notes: Record<string, string>, done: string) => {
    const mark = (k: number) => setNodes((ns) => ns.map((n) => {
      const i = path.indexOf(n.id);
      return { ...n, data: { ...n.data, note: i !== -1 && i <= k ? notes[n.id] : undefined, state: i === -1 ? (k >= path.length ? 'skip' : 'idle') : i < k ? 'done' : i === k ? 'run' : 'idle' } };
    }));
    setRunning(true);
    if (reduced) { mark(path.length); setRunning(false); toast(done, 'info'); return; }
    path.forEach((_, k) => timers.current.push(setTimeout(() => mark(k), k * 650)));
    timers.current.push(setTimeout(() => { mark(path.length); setRunning(false); toast(done, 'info'); }, path.length * 650));
    timers.current.push(setTimeout(() => setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, state: 'idle', note: undefined } }))), path.length * 650 + 6000));
  };
  /** Live: the server walks the saved graph for a recent member. Demo: "yes" at the first condition, "no" after. */
  const testRun = async () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    if (live && wf) {
      if (dirty) {
        if (locked) { toast('Pause the workflow and save to test your changes; this test uses the saved version', 'warn'); }
        else if (!(await save())) return;
      }
      try {
        const r = await testWorkflow(wf.id);
        animate(r.path.map((p) => p.node), Object.fromEntries(r.path.map((p) => [p.node, p.note])), `Test run for ${r.member.handle} (${r.member.country}): ${r.path.length} steps, nothing sent`);
      } catch (e) { fail(e, 'run the test'); }
      return;
    }
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
    animate(path, {}, `Test run finished: ${path.length} steps, no messages sent`);
  };
  const logs = useMemo(() => {
    if (live) return (runs?.runs ?? []).map((r) => ({ id: r.id.slice(-6), member: r.member, at: ago(r.updatedAt), steps: r.path.length, outcome: r.status, note: r.note ?? (r.status === 'waiting' && r.wakeAt ? `waiting until ${new Date(r.wakeAt).toLocaleString()}` : r.path[r.path.length - 1]?.note ?? '') }));
    return runLogs.filter((l) => l.workflow === wf?.id).map((l) => ({ id: l.id, member: l.member, at: l.at, steps: l.path.length, outcome: l.outcome as string, note: l.note }));
  }, [live, runs, wf?.id]);
  const issues = useMemo(() => {
    const out: string[] = [];
    const targets = new Set(edges.map((e) => e.target));
    nodes.forEach((n) => { if (n.data.node.kind !== 'trigger' && !targets.has(n.id)) out.push(`${blockLabel(n.data.node.kind, n.data.node.type)} is not connected`); });
    nodes.filter((n) => n.data.node.kind === 'condition').forEach((n) => { const hs = edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle); if (!hs.includes('yes') || !hs.includes('no')) out.push(`${blockLabel('condition', n.data.node.type)} needs both a yes and a no path`); });
    if (!nodes.some((n) => n.data.node.kind === 'action')) out.push('Add at least one action');
    if (live && nodes.some((n) => n.data.node.type === 'opened')) out.push(OPENED);
    return out;
  }, [nodes, edges, live]);

  if (!wf) return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={q.source} title="Automation builder" subtitle="Build engagement workflows from triggers, conditions, delays and actions." actions={<Button size="sm" disabled={busy} onClick={create}><Plus size={13} /> New workflow</Button>} />
      <Panel className="p-8 text-center text-[12.5px] text-ink-2">No workflows yet. Create one to start from a sign-up trigger.</Panel>
    </div>
  );

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={q.source} title="Automation builder" subtitle={`Build engagement workflows from triggers, conditions, delays and actions. Test runs ${live ? 'use a recent member' : 'use a sample member'} and send nothing.`}
        actions={<>
          <Button size="sm" variant="ghost" disabled={!history.length} onClick={undo}><Undo2 size={13} /> Undo</Button>
          <Button size="sm" variant="ghost" disabled={running || busy} onClick={testRun}><FlaskConical size={13} /> Test run</Button>
          <Button size="sm" variant="ghost" disabled={!dirty || busy || locked} title={locked ? 'Pause the workflow to save changes' : undefined} onClick={() => void save()}>Save</Button>
          {wf.status === 'active'
            ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('pause')}><Power size={13} /> Pause</Button>
            : <Button size="sm" disabled={issues.length > 0 || busy} onClick={() => setConfirm('activate')}><Power size={13} /> Activate</Button>}
        </>} />

      <div className="grid gap-4 xl:grid-cols-[230px_1fr]">
        <div className="space-y-4">
          <Panel className="p-3">
            <SectionTitle eyebrow="Workflows" title={`${list.length} workflow${list.length === 1 ? "" : "s"}`} actions={<Button size="icon-sm" variant="ghost" aria-label="New workflow" disabled={busy} onClick={create}><Plus size={13} /></Button>} />
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
                  <div className="flex flex-wrap gap-1">{blocks[k].map((b) => {
                    const off = !!live && b.type === 'opened';
                    return <Button key={b.type} size="xs" variant="ghost" disabled={off} title={off ? OPENED : undefined} onClick={() => addBlock(k, b.type)} className="border hairline"><Plus size={11} /> {b.label}</Button>;
                  })}</div>
                </div>
              ))}
              <p className="text-2xs text-ink-3">New blocks attach after the selected block.{live && ' “Opened last message” needs open tracking from the delivery provider.'}</p>
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
              <SectionTitle eyebrow={wf.rec ? `Workflow · ${wf.rec.ref}` : 'Workflow'} title={wf.name} />
              <Field label="Name"><input className={inputCls} value={name} disabled={locked} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-center text-[12.5px]">
                <div className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">Runs, 7 days</dt><dd className="num font-semibold">{fmtNum(live ? runs?.stats.runs7d ?? 0 : wf.runs7d)}</dd></div>
                {live
                  ? <div className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">Completed · waiting</dt><dd className="num font-semibold">{fmtNum(runs?.stats.completed7d ?? 0)} · {fmtNum(runs?.stats.waiting ?? 0)}</dd></div>
                  : <div className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">Converted</dt><dd className="num font-semibold">{Math.round(wf.conversion * 100)}%</dd></div>}
              </dl>
              {locked && <p className="mt-2 text-2xs text-ink-3">Active workflows are locked. Pause it to change the blocks.</p>}
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
                <tr key={l.id} className="border-t hairline"><td className="py-1.5 font-mono text-2xs">{l.id}</td><td>{l.member}</td><td className="text-ink-3">{l.at}</td><td className="num">{l.steps}</td>
                  <td><StatusPill status={l.outcome === 'completed' ? 'completed' : l.outcome === 'waiting' ? 'scheduled' : l.outcome === 'failed' ? 'failed' : l.outcome === 'running' ? 'active' : 'closed'} label={l.outcome} /></td><td className="text-ink-2">{l.note}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="py-6 text-center text-2xs text-ink-3">Runs appear here once the workflow is active.</p>}
      </Panel>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} tone={confirm === 'activate' ? 'primary' : 'danger'}
        title={confirm === 'activate' ? `Activate ${wf.name}?` : `Pause ${wf.name}?`}
        body={confirm === 'activate' ? `Members who meet the trigger from now on will start receiving messages and points. Members already past the trigger are not included.${live ? ' E-mails skip members without marketing consent, and each workflow sends at most 500 messages a day.' : ''}` : 'Runs in progress stop at their next step. Nothing more is sent until you activate it again.'}
        confirmLabel={confirm === 'activate' ? 'Activate' : 'Pause'}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void toggle(c); }} />
    </div>
  );
}

export default function Automation() { return <ReactFlowProvider><Builder /></ReactFlowProvider>; }

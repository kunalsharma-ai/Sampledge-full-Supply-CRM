'use client';
import {
  addEdge, Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bell, Clock, GitBranch, Play, Plus, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Badge, Button, Field, inputCls } from '@/components/ui/primitives';

type Kind = 'trigger' | 'condition' | 'agent' | 'approval' | 'action' | 'delay';
type WData = { kind: Kind; title: string; detail: string; retries?: number; gated?: boolean; status?: 'idle' | 'running' | 'ok' | 'skipped' | 'waiting' };
const meta: Record<Kind, { icon: typeof Zap; color: string; label: string }> = {
  trigger: { icon: Zap, color: 'text-cyan border-cyan/50 bg-cyan/10', label: 'Trigger' },
  condition: { icon: GitBranch, color: 'text-orange border-orange/50 bg-orange/10', label: 'Condition' },
  agent: { icon: Sparkles, color: 'text-purple border-purple/50 bg-purple/10', label: 'AI agent' },
  approval: { icon: ShieldCheck, color: 'text-emerald border-emerald/50 bg-emerald/10', label: 'Human approval' },
  action: { icon: Bell, color: 'text-blue border-blue/50 bg-blue/10', label: 'Action' },
  delay: { icon: Clock, color: 'text-ink-2 border-ink-3/40 bg-ink-3/10', label: 'Delay / schedule' },
};

function WNode({ data, selected }: NodeProps<Node<WData>>) {
  const m = meta[data.kind];
  const I = m.icon;
  return (
    <div className={cn('w-[210px] rounded-2xl border bg-surface/95 p-3 shadow-panel transition-all', selected ? 'border-cyan shadow-glow' : 'hairline', data.status === 'running' && 'animate-pulse-soft ring-2 ring-cyan', data.status === 'ok' && 'ring-1 ring-emerald/60', data.status === 'waiting' && 'ring-2 ring-orange')}>
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-3" />}
      <div className="flex items-center gap-2"><span className={cn('grid h-7 w-7 place-items-center rounded-lg border', m.color)}><I size={13} /></span><div className="min-w-0"><div className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-3">{m.label}</div><div className="truncate text-[12px] font-semibold">{data.title}</div></div></div>
      <div className="mt-1.5 line-clamp-2 text-[10.5px] text-ink-3">{data.detail}</div>
      <div className="mt-1.5 flex gap-1">{data.retries ? <Badge>retry ×{data.retries}</Badge> : null}{data.gated && <Badge tone="emerald">needs approval</Badge>}{data.status && data.status !== 'idle' && <Badge tone={data.status === 'ok' ? 'emerald' : data.status === 'waiting' ? 'orange' : data.status === 'running' ? 'cyan' : 'neutral'}>{data.status}</Badge>}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-cyan" />
    </div>
  );
}
const nodeTypes = { w: WNode };

const initialNodes: Node<WData>[] = [
  { id: 't', type: 'w', position: { x: 0, y: 120 }, data: { kind: 'trigger', title: 'Fieldwork IR drops', detail: 'Hourly: project incidence < 70% of quoted IR' } },
  { id: 'c', type: 'w', position: { x: 260, y: 120 }, data: { kind: 'condition', title: 'Completes < 60% of target', detail: 'and deadline within 10 days' } },
  { id: 'a', type: 'w', position: { x: 520, y: 40 }, data: { kind: 'agent', title: 'Vendor Recommendation Agent', detail: 'Rank backup suppliers by CPI, quality, capacity', retries: 2 } },
  { id: 'p', type: 'w', position: { x: 780, y: 40 }, data: { kind: 'approval', title: 'PM approves top-up PO', detail: 'Purchasing sample requires human sign-off', gated: true } },
  { id: 'x', type: 'w', position: { x: 1040, y: 40 }, data: { kind: 'action', title: 'Issue PO + allocate', detail: 'Create allocation, notify vendor thread', retries: 3 } },
  { id: 'n', type: 'w', position: { x: 520, y: 220 }, data: { kind: 'action', title: 'Notify PM & client lead', detail: 'Comms Hub message with IR trend' } },
];
const initialEdges: Edge[] = [
  { id: 'e1', source: 't', target: 'c', animated: true }, { id: 'e2', source: 'c', target: 'a', animated: true, label: 'true' },
  { id: 'e3', source: 'a', target: 'p', animated: true }, { id: 'e4', source: 'p', target: 'x', animated: true, label: 'approved' }, { id: 'e5', source: 'c', target: 'n', animated: true, label: 'always' },
];

function Editor() {
  const toast = useOS((s) => s.toast);
  const canEdit = useOS((s) => ['platform_admin', 'project_manager', 'panel_manager'].includes(s.role));
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WData>>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [sel, setSel] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [version, setVersion] = useState(7);
  const [running, setRunning] = useState(false);
  const selNode = nodes.find((n) => n.id === sel);

  const validate = () => {
    const errs: string[] = [];
    if (!nodes.some((n) => n.data.kind === 'trigger')) errs.push('Workflow needs a trigger.');
    nodes.forEach((n) => { if (n.data.kind !== 'trigger' && !edges.some((e) => e.target === n.id)) errs.push(`“${n.data.title}” is not connected.`); });
    // gated actions must be downstream of an approval
    const up = (id: string, seen = new Set<string>()): string[] => edges.filter((e) => e.target === id && !seen.has(e.source)).flatMap((e) => { seen.add(e.source); return [e.source, ...up(e.source, seen)]; });
    nodes.filter((n) => n.data.kind === 'action' && /PO|payment|quote|publish|delete|email to/i.test(n.data.title)).forEach((n) => { if (!up(n.id).some((u) => nodes.find((x) => x.id === u)?.data.kind === 'approval')) errs.push(`“${n.data.title}” is a consequential action with no upstream human approval.`); });
    return errs;
  };
  const add = (kind: Kind) => {
    const id = `${kind}-${Date.now().toString(36).slice(-4)}`;
    setNodes((ns) => [...ns, { id, type: 'w', position: { x: 260 + Math.random() * 300, y: 320 + Math.random() * 60 }, data: { kind, title: `New ${meta[kind].label.toLowerCase()}`, detail: 'Configure in the inspector', gated: kind === 'approval', retries: kind === 'action' ? 1 : undefined } }]);
    setSel(id);
  };
  const patch = (p: Partial<WData>) => setNodes((ns) => ns.map((n) => (n.id === sel ? { ...n, data: { ...n.data, ...p } } : n)));
  const testRun = async () => {
    const errs = validate();
    if (errs.length) { setLog(errs.map((e) => `✗ ${e}`)); toast('Validation failed', 'warn'); return; }
    setRunning(true); setLog([`▶ Test run (dry-run, no side effects) · v${version}`]);
    const order: string[] = []; const q = nodes.filter((n) => n.data.kind === 'trigger').map((n) => n.id);
    while (q.length) { const id = q.shift()!; if (order.includes(id)) continue; order.push(id); edges.filter((e) => e.source === id).forEach((e) => q.push(e.target)); }
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: 'idle' } })));
    for (const id of order) {
      const n = nodes.find((x) => x.id === id)!;
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, data: { ...x.data, status: 'running' } } : x)));
      await new Promise((r) => setTimeout(r, 650));
      const waiting = n.data.kind === 'approval';
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, data: { ...x.data, status: waiting ? 'waiting' : 'ok' } } : x)));
      setLog((l) => [...l, `${waiting ? '⏸' : '✓'} ${meta[n.data.kind].label}: ${n.data.title}${waiting ? ' → paused for human approval (dry-run continues)' : ''}`]);
    }
    setLog((l) => [...l, '■ Completed. Nothing was sent, purchased or published.']);
    setRunning(false);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative h-[460px] overflow-hidden rounded-2xl border hairline bg-bg/40">
        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          {(Object.keys(meta) as Kind[]).map((k) => <Button key={k} size="sm" className="bg-surface/90" disabled={!canEdit} onClick={() => add(k)}><Plus size={11} />{meta[k].label}</Button>)}
        </div>
        <div className="absolute right-3 top-3 z-10 flex gap-1.5">
          <Button size="sm" className="bg-surface/90" disabled={!canEdit} onClick={() => { const e = validate(); if (e.length) { setLog(e.map((x) => `✗ ${x}`)); toast('Fix validation errors before saving', 'warn'); } else { setVersion((v) => v + 1); toast(`Saved workflow v${version + 1}`); } }}>Save v{version + 1}</Button>
          <Button size="sm" variant="primary" disabled={running} onClick={testRun}><Play size={12} /> Test run</Button>
        </div>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={(c: Connection) => canEdit && setEdges((es) => addEdge({ ...c, animated: true }, es))} onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)}
          fitView fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }} nodesConnectable={canEdit} deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          defaultEdgeOptions={{ style: { stroke: 'rgb(var(--cyan) / .7)', strokeWidth: 1.6 } }}>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ink-3) / .25)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </div>
      <div className="space-y-4">
        <div className="panel-solid p-4 text-[12.5px]">
          <div className="eyebrow mb-2">Inspector</div>
          {selNode ? (
            <div className="space-y-2.5">
              <Field label="Title"><input className={inputCls} value={selNode.data.title} disabled={!canEdit} onChange={(e) => patch({ title: e.target.value })} /></Field>
              <Field label="Configuration"><textarea rows={2} className={cn(inputCls, 'h-auto py-2')} value={selNode.data.detail} disabled={!canEdit} onChange={(e) => patch({ detail: e.target.value })} /></Field>
              {(selNode.data.kind === 'action' || selNode.data.kind === 'agent') && <Field label="Retry policy (attempts, exponential backoff)"><input type="number" min={0} max={5} className={inputCls} value={selNode.data.retries ?? 0} disabled={!canEdit} onChange={(e) => patch({ retries: +e.target.value })} /></Field>}
              <div className="text-2xs text-ink-3">Errors after retries route to the on-call PM and appear as Failed in executions.</div>
            </div>
          ) : <div className="text-ink-3">Select a node to configure it. Add nodes from the toolbar, drag between handles to connect, Backspace deletes.</div>}
        </div>
        <div className="panel-solid p-4">
          <div className="eyebrow mb-2">Run log</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-ink-2">{log.length ? log.join('\n') : 'Run a test to see each step execute.'}</pre>
        </div>
      </div>
    </div>
  );
}
export function WorkflowEditor() { return <ReactFlowProvider><Editor /></ReactFlowProvider>; }

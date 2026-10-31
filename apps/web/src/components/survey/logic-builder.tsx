'use client';
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, ChevronRight, Eye, Plus, Shuffle, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { describeCondition, type Condition, type Question, type Rule, type SurveyDef } from '@/lib/core';
import { useOS } from '@/lib/store';
import { can } from '@/lib/core';
import { palette } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { Badge, Button, Field, inputCls, SearchInput } from '@/components/ui/primitives';

type QData = { q: Question; match: boolean; issues: number; def: SurveyDef };
type BlockData = { block: string; count: number; onExpand: () => void };
type EndData = { kind: 'complete' | 'screenout' | 'overquota'; label: string };
type QuotaData = { label: string; target: number; count: number; cond: string };

const typeLabel: Record<string, string> = { single: 'Single', multi: 'Multi', dropdown: 'Dropdown', text: 'Open text', numeric: 'Numeric', rating: 'Rating', nps: 'NPS', likert: 'Likert', matrix: 'Matrix', ranking: 'Ranking', slider: 'Slider', constant_sum: 'Constant sum', maxdiff: 'MaxDiff', info: 'Info' };

function QuestionNode({ data, selected }: NodeProps<Node<QData>>) {
  const { q, match, issues } = data;
  return (
    <div className={cn('w-[230px] rounded-2xl border bg-surface/95 p-3 text-left shadow-panel backdrop-blur transition-shadow', selected ? 'border-cyan shadow-glow' : 'hairline', match && 'ring-2 ring-magenta')}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-ink-3" />
      <div className="flex items-center gap-1.5">
        <span className="rounded-md bg-blue/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue">{q.id}</span>
        <span className="text-[10px] font-medium text-ink-3">{typeLabel[q.type]}</span>
        {q.randomize && <Shuffle size={10} className="text-purple" aria-label="Randomised" />}
        {issues > 0 && <span className="ml-auto rounded-full bg-danger/15 px-1.5 text-[10px] font-bold text-danger">{issues}</span>}
      </div>
      <div className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-ink">{q.text}</div>
      {q.displayIf && <div className="mt-1.5 flex items-center gap-1 truncate rounded-md bg-orange/10 px-1.5 py-0.5 text-[9.5px] text-orange"><Eye size={9} /> {describeCondition(q.displayIf, data.def)}</div>}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-cyan" />
    </div>
  );
}
function BlockNode({ data }: NodeProps<Node<BlockData>>) {
  return (
    <button onClick={data.onExpand} className="flex w-[230px] items-center gap-2 rounded-2xl border border-dashed border-purple/50 bg-purple/10 p-3 text-left">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <ChevronRight size={14} className="text-purple" /><span className="text-[12px] font-semibold">{data.block}</span><Badge tone="purple">{data.count} questions</Badge>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </button>
  );
}
function EndNode({ data }: NodeProps<Node<EndData>>) {
  const c = data.kind === 'complete' ? 'emerald' : data.kind === 'screenout' ? 'danger' : 'orange';
  return (
    <div className={cn('rounded-full border px-4 py-2 text-[12px] font-semibold', c === 'emerald' ? 'border-emerald/50 bg-emerald/10 text-emerald' : c === 'danger' ? 'border-danger/50 bg-danger/10 text-danger' : 'border-orange/50 bg-orange/10 text-orange')}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-current" />
      {data.label}
    </div>
  );
}
function QuotaNode({ data }: NodeProps<Node<QuotaData>>) {
  const pct = data.count / data.target;
  return (
    <div className="w-[190px] rounded-xl border border-cyan/40 bg-cyan/5 p-2.5 text-[11px]">
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex justify-between font-semibold"><span>Quota · {data.label}</span></div>
      <div className="text-[9.5px] text-ink-3">{data.cond}</div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-3/20"><div className={cn('h-full rounded-full', pct >= 1 ? 'bg-danger' : pct > 0.85 ? 'bg-orange' : 'bg-cyan')} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
      <div className="num mt-1 text-[10px] text-ink-2">{data.count} / {data.target}{pct >= 1 ? ' · full' : ''}</div>
    </div>
  );
}
const nodeTypes = { question: QuestionNode, block: BlockNode, end: EndNode, quota: QuotaNode };

function Inspector({ def, q, onChange }: { def: SurveyDef; q: Question; onChange: (next: SurveyDef, label: string) => void }) {
  const [text, setText] = useState(q.text);
  const setQ = (patch: Partial<Question>, label: string) => onChange({ ...def, questions: def.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)) }, label);
  const prior = def.questions.slice(0, def.questions.findIndex((x) => x.id === q.id)).filter((x) => x.options?.length);
  const di = q.displayIf && 'op' in q.displayIf && q.displayIf.op === 'eq' ? q.displayIf : null;
  const rules = def.rules.filter((r) => r.after === q.id);
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="flex items-center gap-2"><Badge tone="blue">{q.id}</Badge><span className="text-ink-3">{typeLabel[q.type]} · {q.block}</span></div>
      <Field label="Question text"><textarea rows={3} className={cn(inputCls, 'h-auto py-2')} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== q.text && setQ({ text }, `Edited ${q.id} text`)} /></Field>
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!q.randomize} onChange={(e) => setQ({ randomize: e.target.checked }, `${e.target.checked ? 'Randomised' : 'Unrandomised'} ${q.id}`)} className="accent-cyan" /> Randomise options</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.required !== false} onChange={(e) => setQ({ required: e.target.checked }, `Required ${q.id}`)} className="accent-cyan" /> Required</label>
      </div>
      <Field label="Display logic" hint={q.displayIf && !di ? `Complex: ${describeCondition(q.displayIf, def)}` : undefined}>
        <div className="flex gap-2">
          <select className={inputCls} value={di?.q ?? ''} onChange={(e) => { const src = def.questions.find((x) => x.id === e.target.value); setQ({ displayIf: src ? { q: src.id, op: 'eq', value: src.options![0].code } : undefined }, `Display logic on ${q.id}`); }}>
            <option value="">Always show</option>{prior.map((p) => <option key={p.id} value={p.id}>{p.id} =</option>)}
          </select>
          {di && <select className={inputCls} value={di.value} onChange={(e) => setQ({ displayIf: { q: di.q, op: 'eq', value: e.target.value } }, `Display logic on ${q.id}`)}>
            {def.questions.find((x) => x.id === di.q)?.options?.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>}
        </div>
      </Field>
      {q.options && (
        <div>
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">Answer options</div>
          <ul className="space-y-1">
            {q.options.map((o) => (
              <li key={o.code} className="flex items-center gap-2 rounded-lg bg-surface-2/40 px-2 py-1">
                <span className="w-12 truncate font-mono text-[10px] text-ink-3">{o.code}</span><span className="flex-1 truncate">{o.label}</span>{o.exclusive && <Badge tone="orange">excl.</Badge>}
                <button aria-label={`Remove ${o.label}`} onClick={() => setQ({ options: q.options!.filter((x) => x.code !== o.code) }, `Removed option ${o.code} from ${q.id}`)}><Trash2 size={12} className="text-ink-3 hover:text-danger" /></button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => { const code = `o${q.options!.length + 1}`; setQ({ options: [...q.options!, { code, label: `New option ${q.options!.length + 1}` }] }, `Added option to ${q.id}`); }}><Plus size={12} /> Add option</Button>
        </div>
      )}
      <div>
        <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">Routing after {q.id}</div>
        {rules.length ? rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b hairline py-1 text-[11.5px] last:border-0">
            <span className="flex-1">If {describeCondition(r.when, def)} → {'goto' in r.action ? `go to ${r.action.goto}` : r.action.terminate}</span>
            <button aria-label="Delete rule" onClick={() => onChange({ ...def, rules: def.rules.filter((x) => x.id !== r.id) }, `Deleted rule ${r.id}`)}><Trash2 size={12} className="text-ink-3 hover:text-danger" /></button>
          </div>
        )) : <div className="text-2xs text-ink-3">Continues to the next visible question. Drag from this node’s bottom handle to add a branch.</div>}
      </div>
    </div>
  );
}

function Builder({ def, issuesByQ }: { def: SurveyDef; issuesByQ: Record<string, number> }) {
  const update = useOS((s) => s.updateSurvey);
  const canEdit = useOS((s) => can(s.role, 'edit:surveys'));
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Connection | null>(null);
  const [cond, setCond] = useState<string>('*');
  const flow = useReactFlow();
  const blocks = [...new Set(def.questions.map((q) => q.block ?? 'Main'))];
  const toast = useOS((s) => s.toast);
  const onChange = (next: SurveyDef, label: string) => (canEdit ? update(def.id, next, label) : toast('Read only: switch to the Survey Programmer role to edit', 'warn'));

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const posOf: Record<string, { x: number; y: number }> = {};
    blocks.forEach((b, bi) => {
      const qs = def.questions.filter((q) => (q.block ?? 'Main') === b);
      if (collapsed.includes(b)) {
        nodes.push({ id: `block:${b}`, type: 'block', position: { x: bi * 290, y: 0 }, data: { block: b, count: qs.length, onExpand: () => setCollapsed((c) => c.filter((x) => x !== b)) } });
        qs.forEach((q) => (posOf[q.id] = { x: bi * 290, y: 0 }));
        return;
      }
      qs.forEach((q, i) => {
        posOf[q.id] = { x: bi * 290, y: i * 128 };
        nodes.push({ id: q.id, type: 'question', position: posOf[q.id], data: { q, def, match: !!search && (q.id + ' ' + q.text).toLowerCase().includes(search.toLowerCase()), issues: issuesByQ[q.id] ?? 0 }, selected: q.id === selected });
      });
    });
    const endX = blocks.length * 290 + 20;
    nodes.push({ id: 'end:complete', type: 'end', position: { x: endX, y: 40 }, data: { kind: 'complete', label: '✓ Complete' }, draggable: true });
    nodes.push({ id: 'end:screenout', type: 'end', position: { x: endX, y: 140 }, data: { kind: 'screenout', label: '⨯ Screen-out' } });
    nodes.push({ id: 'end:overquota', type: 'end', position: { x: endX, y: 240 }, data: { kind: 'overquota', label: '◐ Over quota' } });
    def.quotas.forEach((qt, i) => nodes.push({ id: `quota:${qt.id}`, type: 'quota', position: { x: endX, y: 340 + i * 96 }, data: { label: qt.label, target: qt.target, count: qt.count, cond: describeCondition(qt.when, def) } }));

    const nid = (qid: string) => { const q = def.questions.find((x) => x.id === qid); const b = q?.block ?? 'Main'; return collapsed.includes(b) ? `block:${b}` : qid; };
    const seen = new Set<string>();
    def.questions.forEach((q, i) => {
      const next = def.questions[i + 1];
      const a = nid(q.id), b = next ? nid(next.id) : 'end:complete';
      const k = `${a}->${b}`;
      if (a !== b && !seen.has(k)) { seen.add(k); edges.push({ id: `seq:${q.id}`, source: a, target: b, deletable: false, style: { stroke: 'rgb(var(--ink-3) / .45)', strokeWidth: 1.4 } }); }
    });
    def.rules.forEach((r) => {
      const target = 'goto' in r.action ? nid(r.action.goto) : `end:${r.action.terminate}`;
      const color = 'goto' in r.action ? palette.purple : r.action.terminate === 'screenout' ? palette.danger : palette.orange;
      edges.push({ id: `rule:${r.id}`, source: nid(r.after), target, animated: true, label: describeCondition(r.when, def), labelStyle: { fill: color, fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: 'rgb(var(--surface))', fillOpacity: 0.95 }, labelBgPadding: [4, 2], labelBgBorderRadius: 4, style: { stroke: color, strokeWidth: 1.8 } });
    });
    def.quotas.forEach((qt) => { const src = 'q' in qt.when ? nid(qt.when.q as string) : null; if (src) edges.push({ id: `qe:${qt.id}`, source: src, target: `quota:${qt.id}`, deletable: false, style: { stroke: palette.cyan, strokeDasharray: '3 4', strokeOpacity: 0.5 } }); });
    return { nodes, edges };
  }, [def, collapsed, search, selected, issuesByQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = def.questions.find((q) => q.id === selected);
  const src = pending ? def.questions.find((q) => q.id === pending.source) : undefined;

  const commitRule = () => {
    if (!pending || !src) return;
    const when: Condition | null = cond === '*' ? null : { q: src.id, op: 'eq', value: cond };
    const t = pending.target!;
    const action: Rule['action'] = t.startsWith('end:') ? { terminate: t.slice(4) as 'complete' | 'screenout' | 'overquota' } : { goto: t };
    const id = `r${Date.now().toString(36).slice(-4)}`;
    onChange({ ...def, rules: [...def.rules, { id, after: src.id, when, action }] }, `Added rule ${id}: ${src.id} → ${t}`);
    setPending(null); setCond('*');
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative h-[640px] overflow-hidden rounded-2xl border hairline bg-bg/40">
        <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={(v) => { setSearch(v); const hit = def.questions.find((q) => v && (q.id + ' ' + q.text).toLowerCase().includes(v.toLowerCase())); if (hit) flow.fitView({ nodes: [{ id: hit.id }], duration: 500, maxZoom: 1.2 }); }} placeholder="Find question…" className="w-56 bg-surface/90" />
          <div className="flex flex-wrap gap-1">
            {blocks.map((b) => (
              <Button key={b} size="sm" variant={collapsed.includes(b) ? 'subtle' : 'outline'} className="bg-surface/90" onClick={() => setCollapsed((c) => (c.includes(b) ? c.filter((x) => x !== b) : [...c, b]))}>
                {collapsed.includes(b) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{b}
              </Button>
            ))}
          </div>
        </div>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12, nodes: def.questions.filter((q) => blocks.slice(0, 3).includes(q.block ?? 'Main')).map((q) => ({ id: q.id })), maxZoom: 1.1 }} minZoom={0.2} maxZoom={1.8}
          nodesConnectable={canEdit} nodesDraggable elementsSelectable
          onNodeClick={(_, n) => def.questions.some((q) => q.id === n.id) && setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          onConnect={(c) => { if (!canEdit || !def.questions.some((q) => q.id === c.source) || c.source === c.target) return; setPending(c); }}
          onEdgesDelete={(es) => { const ids = es.filter((e) => e.id.startsWith('rule:')).map((e) => e.id.slice(5)); if (ids.length && canEdit) onChange({ ...def, rules: def.rules.filter((r) => !ids.includes(r.id)) }, `Deleted rule ${ids.join(', ')}`); }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ink-3) / .25)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" style={{ width: 170, height: 110 }} nodeColor={(n) => (n.type === 'end' ? palette.emerald : n.type === 'quota' ? palette.cyan : palette.blue)} maskColor="rgb(8 13 31 / .55)" />
        </ReactFlow>
        {pending && src && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-bg/50 backdrop-blur-sm">
            <div className="panel w-80 p-4">
              <div className="mb-2 font-display text-sm font-semibold">New branch: {src.id} → {pending.target?.replace('end:', '')}</div>
              <Field label="When">
                <select className={inputCls} value={cond} onChange={(e) => setCond(e.target.value)}>
                  <option value="*">Always (unconditional)</option>
                  {src.options?.map((o) => <option key={o.code} value={o.code}>{src.id} = {o.label}</option>)}
                </select>
              </Field>
              <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={commitRule}>Add rule</Button></div>
            </div>
          </div>
        )}
      </div>
      <div className="panel-solid h-fit p-4">
        <div className="eyebrow mb-3">Inspector</div>
        {sel ? <Inspector key={sel.id + def.version} def={def} q={sel} onChange={onChange} /> : (
          <div className="space-y-2 text-[12px] text-ink-3">
            <p>Select a question to edit text, options, display logic and routing.</p>
            <p>Drag from a question’s bottom handle to another question or an end node to create a branch. Select a coloured rule edge and press Backspace to delete it.</p>
            <div className="flex flex-wrap gap-2 pt-1"><Badge tone="purple">Goto</Badge><Badge tone="danger">Screen-out</Badge><Badge tone="cyan">Quota</Badge><Badge tone="orange">Display logic</Badge></div>
            {!canEdit && <p className="text-orange">Read only: switch role to Survey Programmer to edit.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function LogicBuilder(props: { def: SurveyDef; issuesByQ: Record<string, number> }) {
  return <ReactFlowProvider><Builder {...props} /></ReactFlowProvider>;
}

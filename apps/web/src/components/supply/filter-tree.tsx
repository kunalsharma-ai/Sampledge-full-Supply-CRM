'use client';
/**
 * Nested AND/OR filter editor for audience definitions. Each condition shows how many panellists
 * it matches on its own, so the operator can see which rule is doing the narrowing.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Trash2, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { MultiSelect } from '@/components/ui/forms';
import { Button, inputCls } from '@/components/ui/primitives';
import { cond, fieldByKey, fields, group, matches, type Condition, type Group, type Node } from '@/lib/supply/audience';
import { SCALE, type Panellist } from '@/lib/supply/panellists';
import { cn, fmtCompact } from '@/lib/utils';

const optLabel: Record<string, string> = { t2o: 'Turn2Opinion', mfr: 'MyFrequentRewards', mho: 'MyHealthOpinions', hcp: 'Healthcare professional', professional: 'B2B professional' };

export function FilterTree({ root, onChange, sample, depth = 0, onRemove }: { root: Group; onChange: (g: Group) => void; sample: Panellist[]; depth?: number; onRemove?: () => void }) {
  const setChild = (i: number, n: Node | null) => onChange({ ...root, children: n ? root.children.map((c, k) => (k === i ? n : c)) : root.children.filter((_, k) => k !== i) });
  return (
    <div className={cn('rounded-xl border p-2.5', depth === 0 ? 'hairline bg-surface-2/20' : 'border-dashed border-primary/30 bg-primary/[.03]')}>
      <div className="mb-2 flex items-center gap-2">
        <div role="radiogroup" aria-label="Combine rules with" className="inline-flex rounded-lg border hairline p-0.5 text-2xs font-bold">
          {(['AND', 'OR'] as const).map((j) => (
            <button key={j} role="radio" aria-checked={root.join === j} onClick={() => onChange({ ...root, join: j })}
              className={cn('rounded-md px-2 py-0.5', root.join === j ? 'bg-primary-strong text-on-primary' : 'text-ink-3 hover:text-ink')}>{j}</button>
          ))}
        </div>
        <span className="text-2xs text-ink-3">{root.join === 'AND' ? 'Match all of these' : 'Match any of these'}</span>
        {onRemove && <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Remove group" onClick={onRemove}><Trash2 size={13} /></Button>}
      </div>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {root.children.map((c, i) => (
            <motion.li key={c.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16 }}>
              {i > 0 && <div className="my-1 pl-2 text-[10px] font-bold tracking-wider text-ink-3">{root.join}</div>}
              {c.kind === 'group'
                ? <FilterTree root={c} sample={sample} depth={depth + 1} onChange={(g) => setChild(i, g)} onRemove={() => setChild(i, null)} />
                : <ConditionRow c={c} sample={sample} onChange={(n) => setChild(i, n)} onRemove={() => setChild(i, null)} />}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="mt-2 flex gap-1.5">
        <Button size="xs" variant="ghost" onClick={() => onChange({ ...root, children: [...root.children, cond('country')] })}><Plus size={12} /> Rule</Button>
        {depth < 2 && <Button size="xs" variant="ghost" onClick={() => onChange({ ...root, children: [...root.children, group(root.join === 'AND' ? 'OR' : 'AND', [cond('ageBand')])] })}><Layers size={12} /> Group</Button>}
      </div>
    </div>
  );
}

function ConditionRow({ c, onChange, onRemove, sample }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void; sample: Panellist[] }) {
  const f = fieldByKey(c.field);
  const count = sample.filter((p) => matches(p, c)).length;
  const numeric = f.type === 'number';
  let editor: ReactNode;
  if (numeric) {
    editor = (
      <span className="flex items-center gap-1.5">
        <select aria-label="Comparison" className={cn(inputCls, 'h-8 w-16 px-2')} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Condition['op'] })}>
          <option value="gte">≥</option><option value="lte">≤</option>
        </select>
        <input aria-label={`${f.label} value`} type="number" className={cn(inputCls, 'h-8 w-20')} value={c.num ?? ''} onChange={(e) => onChange({ ...c, num: e.target.value === '' ? undefined : Number(e.target.value) })} />
        {f.unit && <span className="text-2xs text-ink-3">{f.unit}</span>}
      </span>
    );
  } else {
    editor = (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <select aria-label="Operator" className={cn(inputCls, 'h-8 w-20 px-2')} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as Condition['op'] })}>
          <option value="in">is</option><option value="not_in">is not</option>
        </select>
        <MultiSelect label={f.label} className="min-h-8 flex-1" value={c.values} onChange={(values) => onChange({ ...c, values })} options={(f.options ?? []).map((o) => ({ value: o, label: optLabel[o] ?? o }))} placeholder="Choose values…" />
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface/60 p-1.5">
      <select aria-label="Attribute" className={cn(inputCls, 'h-8 w-40 px-2')} value={c.field}
        onChange={(e) => { const nf = fieldByKey(e.target.value); onChange({ ...c, field: nf.key, op: nf.type === 'number' ? 'gte' : 'in', values: [], num: undefined }); }}>
        {(['Panel', 'Demographic', 'B2B', 'Healthcare', 'Engagement'] as const).map((g) => (
          <optgroup key={g} label={g}>{fields.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
        ))}
      </select>
      {editor}
      <span className="num ml-auto w-14 text-right text-2xs text-ink-3" title="Panellists matching this rule on its own (estimate)">{fmtCompact(count * SCALE)}</span>
      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.label} rule`} onClick={onRemove}><Trash2 size={13} /></Button>
    </div>
  );
}

'use client';
/**
 * Screen 13 · AI Audience Segmentation. Split screen: natural-language input on top, the nested
 * filter tree with live counts on the left, the audience's make-up on the right. Hands off to
 * Feasibility with the definition in the URL.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Calculator, CornerDownLeft, Save, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel, buttonVariants, inputCls } from '@/components/ui/primitives';
import { AnimatedNumber } from '@/components/ui/kpi';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { FilterTree } from '@/components/supply/filter-tree';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { cond, decodeRoot, describe, encodeRoot, filterSample, group, translate, type Group, type SavedSegment } from '@/lib/supply/audience';
import { panellists, SCALE } from '@/lib/supply/panellists';
import { panelBrands } from '@/lib/supply/demo';
import { screenBySlug } from '@/lib/supply/screens';
import { fmtNum } from '@/lib/utils';

const NONE: never[] = [];
const screen = screenBySlug('segmentation')!;
const examples = [
  'Find 1,500 cardiologists in the USA, UK and Germany with at least five years of professional experience for PRJ-1045',
  'Women aged 25-44 in the UK and France, high income',
  'IT decision makers at enterprise companies in the US and Canada',
  'People living with type 2 diabetes in the US, aged 45-64',
];
const starter = () => group('AND', [cond('status', ['active']), cond('country', ['US', 'GB'])]);

export default function Page() { return <Suspense><Segmentation /></Suspense>; }

function Segmentation() {
  const params = useSearchParams();
  const toast = useOS((s) => s.toast);
  const saved = useOS((s) => s.prefs['segments'] as SavedSegment[] | undefined) ?? NONE;
  const setPref = useOS((s) => s.setPref);
  const [root, setRootRaw] = useState<Group>(starter);
  const [history, setHistory] = useState<Group[]>([]);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<number | undefined>();
  const [tr, setTr] = useState<ReturnType<typeof translate> | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const setRoot = (g: Group) => { setHistory((h) => [...h.slice(-29), root]); setRootRaw(g); };
  useEffect(() => { const d = params.get('def'); const g = d && decodeRoot(d); if (g) setRootRaw(g); }, [params]);

  const sample = panellists();
  const matched = useMemo(() => filterSample(sample, root), [sample, root]);
  const est = Math.round(matched.length * SCALE);
  const summary = describe(root) || 'Everyone';

  const run = (t = text) => {
    if (!t.trim()) return;
    const r = translate(t);
    setTr(r); setTarget(r.target); setRoot(r.root); setText(t);
  };
  const dist = (key: (p: (typeof sample)[number]) => string | undefined) => {
    const m = new Map<string, number>();
    for (const p of matched) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byCountry = dist((p) => p.country).slice(0, 8);
  const byAge = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'].map((a) => [a, matched.filter((p) => p.ageBand === a).length] as const);
  const byPanel = panelBrands.map((b) => ({ name: b.short, value: matched.filter((p) => p.brand === b.id).length, itemStyle: { color: b.color } }));
  const bySeg = dist((p) => p.specialty ?? p.jobRole ?? p.segment).slice(0, 6);
  const feasHref = `/supply/feasibility?def=${encodeURIComponent(encodeRoot(root))}${target ? `&target=${target}` : ''}`;

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source="demo" title="Audience builder"
        subtitle="Describe the audience in plain language or build it rule by rule. Counts update as you go and are estimates from the panel sample."
        actions={<>
          <Button size="sm" variant="ghost" disabled={!history.length} onClick={() => { setRootRaw(history[history.length - 1]); setHistory(history.slice(0, -1)); }}><Undo2 size={13} /> Undo</Button>
          <Button size="sm" onClick={() => setSaveOpen(true)}><Save size={13} /> Save segment</Button>
          <Link href={feasHref} className={buttonVariants({ variant: 'primary', size: 'sm' })}><Calculator size={13} /> Check feasibility</Link>
        </>} />

      {/* Natural-language bar */}
      <Panel className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex flex-col gap-2 md:flex-row md:items-center">
          <label htmlFor="nl" className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-purple"><Sparkles size={15} /> Describe your audience</label>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-purple/30 bg-purple/[.06] pr-1.5 focus-within:border-purple/60">
            <input id="nl" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 800 nurses in the UK with 5+ years of experience" className="h-10 w-full bg-transparent px-3 text-[13.5px] outline-none placeholder:text-ink-3" />
            <Button size="xs" variant="subtle" type="submit" disabled={!text.trim()}><CornerDownLeft size={12} /> Translate</Button>
          </div>
        </form>
        {!tr && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {examples.map((e) => <button key={e} onClick={() => run(e)} className="max-w-full truncate rounded-full border hairline px-2.5 py-1 text-2xs text-ink-2 hover:border-purple/40 hover:text-ink">{e}</button>)}
          </div>
        )}
        {tr && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs" aria-live="polite">
            <Badge tone="purple">Rule-based translation (demo)</Badge>
            {tr.recognised.map((r) => <Badge key={r} tone="neutral">{r}</Badge>)}
            {tr.target && <Badge tone="cyan">target {fmtNum(tr.target)} completes</Badge>}
            {tr.notes.map((n) => <span key={n} className="text-warn">{n}</span>)}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="min-w-0 p-4">
          <SectionTitle eyebrow="Definition" title="Rules" actions={<Button size="xs" variant="ghost" onClick={() => setRoot(starter())}><Trash2 size={12} /> Reset</Button>} />
          <FilterTree root={root} onChange={setRoot} sample={sample} />
          <p className="mt-3 rounded-lg bg-surface-2/40 p-2.5 text-[12.5px] text-ink-2"><span className="eyebrow mr-1.5">Reads as</span>{summary}</p>
        </Panel>

        <Panel className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">Eligible panellists (estimate)</div>
              <AnimatedNumber value={est} format={(n) => fmtNum(Math.round(n))} duration={0.5} className="font-jakarta text-[34px] font-bold leading-none tracking-tight" />
              <div className="mt-1 text-2xs text-ink-3">{fmtNum(matched.length)} of {fmtNum(sample.length)} in the sample · ±{Math.round(100 / Math.sqrt(Math.max(1, matched.length)))}%</div>
            </div>
            {target && <div className="text-right"><div className="eyebrow">Target</div><div className="num font-jakarta text-xl font-bold">{fmtNum(target)}</div><div className="text-2xs text-ink-3">{(est / target).toFixed(1)}× eligible per complete</div></div>}
          </div>
          {matched.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed hairline py-16 text-center text-[13px] text-ink-3">No panellists match. Loosen a rule or switch a group to OR.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <EChart ariaLabel="Eligible panellists by country" height={180} deps={[matched.length, summary]} option={(t) => ({
                grid: { left: 4, right: 30, top: 6, bottom: 4, containLabel: true }, tooltip: { trigger: 'axis' },
                xAxis: { type: 'value', show: false }, yAxis: { type: 'category', inverse: true, data: byCountry.map((c) => c[0]), ...axis(t, { splitLine: { show: false } }) },
                series: [{ type: 'bar', name: 'Eligible', data: byCountry.map((c) => Math.round(c[1] * SCALE)), barWidth: 10, itemStyle: { borderRadius: 5 }, label: { show: true, position: 'right', fontSize: 10, textBorderWidth: 0, color: 'inherit', formatter: (p: { value?: unknown }) => Intl.NumberFormat('en', { notation: 'compact' }).format(Number(p.value)) } }],
              })} />
              <EChart ariaLabel="Eligible panellists by panel" height={180} deps={[matched.length, summary]} option={() => ({
                tooltip: { trigger: 'item' }, legend: { bottom: 0, top: 'auto' },
                series: [{ type: 'pie', radius: ['48%', '72%'], center: ['50%', '44%'], data: byPanel, label: { show: false }, itemStyle: { borderWidth: 0 } }],
              })} />
              <EChart ariaLabel="Eligible panellists by age band" height={160} deps={[matched.length, summary]} option={(t) => ({
                grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true }, tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: byAge.map((a) => a[0]), ...axis(t, { splitLine: { show: false } }) }, yAxis: { type: 'value', show: false },
                series: [{ type: 'bar', name: 'Eligible', data: byAge.map((a) => Math.round(a[1] * SCALE)), barWidth: 16, itemStyle: { borderRadius: [4, 4, 0, 0], color: 'rgb(var(--chart-3))' } }],
              })} />
              <div>
                <div className="eyebrow mb-1.5">Top segments</div>
                <ul className="space-y-1 text-[12.5px]">
                  {bySeg.map(([k, v]) => <li key={k} className="flex justify-between capitalize"><span className="truncate text-ink-2">{k}</span><span className="num font-semibold">{fmtNum(Math.round(v * SCALE))}</span></li>)}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {saved.length > 0 && (
        <Panel className="p-4">
          <SectionTitle eyebrow="Saved segments" title="Reuse a definition" />
          <ul className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-1 rounded-xl border hairline py-1 pl-3 pr-1 text-[12.5px]">
                <button onClick={() => setRoot(s.root)} className="font-medium hover:text-primary">{s.name}</button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setPref('segments', saved.filter((x) => x.id !== s.id))}><Trash2 size={12} /></Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title="Save segment" description={summary}>
          <input autoFocus className={inputCls} placeholder="Segment name" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={() => { setPref('segments', [...saved, { id: Date.now().toString(36), name: name.trim(), root, createdAt: new Date().toISOString() }]); setSaveOpen(false); setName(''); toast('Segment saved'); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

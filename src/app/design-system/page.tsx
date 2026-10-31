'use client';
import { useState } from 'react';
import { palette, radii, typeScale, motion as motionTokens } from '@/lib/tokens';
import { roles, moduleAccess, permissionsFor, type ModuleId } from '@/lib/roles';
import { modules } from '@/lib/modules';
import { KpiCard, Sparkline } from '@/components/ui/kpi';
import { Badge, Bar, Button, DemoBadge, EmptyState, ErrorState, Field, inputCls, PageHeader, Panel, PanelHeader, ProgressRing, SearchInput, Segmented, Skeleton } from '@/components/ui/primitives';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';

const swatches: [string, string, string][] = [
  ['Midnight Navy', palette.midnight, 'Base background'], ['Deep Space Blue', palette.deepSpace, 'Raised background'],
  ['Electric Blue', palette.blue, 'Primary action, focus'], ['Royal Purple', palette.purple, 'AI, premium accents'], ['Neon Cyan', palette.cyan, 'Data highlight, live'],
  ['Emerald Green', palette.emerald, 'Success, healthy'], ['Warm Orange', palette.orange, 'Warning, demo'], ['Premium Magenta', palette.magenta, 'Selection, today'],
];

export default function DesignSystem() {
  const setTheme = useOS((s) => s.setTheme);
  const theme = useOS((s) => s.theme);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [q, setQ] = useState('');
  const shown = modules.filter((m) => m.id !== 'design-system');
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Phase 1 deliverable" title="Sampledge design system" subtitle="Tokens, themes and the component library every module is built from. Tokens live in globals.css (CSS variables) and lib/tokens.ts (JS mirror for charts and 3D)."
        actions={<Segmented label="ds-theme" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Premium Dark' }, { value: 'light', label: 'Executive Light' }, { value: 'system', label: 'Adaptive' }]} />} />

      <Panel>
        <PanelHeader eyebrow="Colour" title="Brand palette and semantic roles" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {swatches.map(([n, hex, role]) => (
            <div key={n} className="overflow-hidden rounded-2xl border hairline">
              <div className="h-16" style={{ background: hex }} />
              <div className="p-3 text-[12px]"><div className="font-semibold">{n}</div><div className="font-mono text-2xs text-ink-3">{hex}</div><div className="text-2xs text-ink-2">{role}</div></div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-2xs text-ink-3">Rules: one accent per meaning; gradients only on primary actions, hero text and data fills; glass is one level deep and never stacked.</p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Typography" title="Manrope display · Inter UI · Plus Jakarta Sans metrics" />
          <div className="space-y-3">
            {Object.entries(typeScale).map(([k, t]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b hairline pb-2 last:border-0">
                <span style={{ fontSize: Math.min(t.size, 36), fontWeight: t.weight, letterSpacing: `${t.tracking}em`, fontFamily: t.family === 'Manrope' ? 'var(--font-manrope)' : t.family === 'Plus Jakarta Sans' ? 'var(--font-jakarta)' : 'var(--font-inter)', textTransform: k === 'eyebrow' ? 'uppercase' : undefined }}>
                  {k === 'metric' ? '$631.7K' : k === 'eyebrow' ? 'Section eyebrow' : 'Research intelligence'}
                </span>
                <span className="shrink-0 font-mono text-2xs text-ink-3">{k} · {t.size}/{t.weight}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Spacing, radii, motion" title="Scales" />
          <div className="space-y-4 text-[12px]">
            <div className="flex flex-wrap items-end gap-3">{[4, 8, 12, 16, 24, 32, 48].map((s) => <div key={s} className="text-center"><div className="rounded bg-cyan/60" style={{ width: s, height: s }} /><div className="mt-1 font-mono text-2xs text-ink-3">{s}</div></div>)}</div>
            <div className="flex flex-wrap gap-3">{Object.entries(radii).map(([k, r]) => <div key={k} className="grid h-14 w-14 place-items-center border border-blue/60 bg-blue/10 font-mono text-2xs" style={{ borderRadius: Math.min(r, 28) }}>{k}</div>)}</div>
            <div className="font-mono text-2xs text-ink-2">{Object.entries(motionTokens).map(([k, v]) => `${k}: ${Array.isArray(v) ? `cubic-bezier(${v.join(',')})` : `${v}s`}`).join(' · ')}</div>
            <p className="text-2xs text-ink-3">Reduced motion (OS setting or the ⚡ toggle) cuts transitions to ~0 and stops particles, auto-rotation and dash flows.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader eyebrow="Components" title="Library" actions={<DemoBadge />} />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3">
            <div className="eyebrow">Buttons</div>
            <div className="flex flex-wrap gap-2"><Button variant="primary">Primary</Button><Button>Outline</Button><Button variant="subtle">Subtle</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button disabled>Disabled</Button></div>
            <div className="eyebrow pt-2">Badges</div>
            <div className="flex flex-wrap gap-1.5">{(['blue', 'cyan', 'purple', 'emerald', 'orange', 'magenta', 'danger', 'warn', 'neutral'] as const).map((t) => <Badge key={t} tone={t} dot>{t}</Badge>)}</div>
            <div className="eyebrow pt-2">Inputs</div>
            <SearchInput value={q} onChange={setQ} />
            <Field label="Field" hint="Hint text"><input className={inputCls} placeholder="Value" /></Field>
            <Segmented label="ds-seg" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Day' }, { value: 'b', label: 'Week' }, { value: 'c', label: 'Month' }]} />
          </div>
          <div className="space-y-3">
            <div className="eyebrow">KPI card</div>
            <KpiCard label="Survey completes" value={8241} format={(n) => Math.round(n).toLocaleString()} delta={0.112} spark={[3, 4, 3.6, 5, 4.8, 6, 6.4, 7]} href="/projects" />
            <KpiCard label="Project profitability" value={0.4} format={(n) => `${(n * 100).toFixed(1)}%`} redacted />
            <div className="eyebrow pt-2">Progress</div>
            <div className="flex items-center gap-4"><ProgressRing value={0.72} /><ProgressRing value={0.38} color={palette.orange} sub="38/100" /><div className="flex-1 space-y-2"><Bar value={0.8} tone="emerald" /><Bar value={0.45} /><Bar value={0.2} tone="danger" /></div></div>
            <div className="eyebrow pt-2">Sparkline</div>
            <Sparkline data={[4, 6, 5, 8, 7, 9, 12, 10, 13]} color={palette.purple} />
          </div>
          <div className="space-y-3">
            <div className="eyebrow">States</div>
            <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16" /></div>
            <EmptyState title="No projects match" body="Clear filters to see all projects." action={<Button size="sm">Clear filters</Button>} />
            <ErrorState body="The visualisation library could not be loaded." onRetry={() => undefined} />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="Role matrix" title="Module access by role" actions={<span className="text-2xs text-ink-3">Source: src/lib/roles.ts · switch role in the top bar</span>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[11.5px]">
            <thead><tr className="text-2xs text-ink-3"><th className="py-2 text-left font-semibold">Module</th>{roles.map((r) => <th key={r.id} className="px-1 py-2 font-semibold">{r.label}</th>)}</tr></thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} className="border-t hairline">
                  <td className="py-1.5 font-medium">{m.label}</td>
                  {roles.map((r) => { const a = moduleAccess[m.id as ModuleId][r.id]; return <td key={r.id} className="px-1 py-1.5 text-center"><span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold', a === 'full' ? 'bg-emerald/15 text-emerald' : a === 'read' ? 'bg-blue/15 text-blue' : a === 'scoped' ? 'bg-orange/15 text-orange' : 'text-ink-3/50')}>{a === 'none' ? '—' : a}</span></td>; })}
                </tr>
              ))}
              <tr className="border-t hairline align-top"><td className="py-2 font-medium">Permissions</td>{roles.map((r) => <td key={r.id} className="px-1 py-2 text-[9.5px] text-ink-3">{permissionsFor(r.id).map((p) => <div key={p}>{p}</div>)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

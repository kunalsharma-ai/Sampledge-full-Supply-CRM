'use client';
/**
 * Screen 42 · Theme Customization Studio. Pick one of six Audience Orbit X themes (or follow the
 * OS), density, text size and motion. Every choice applies instantly, persists on this device, and
 * the contrast panel re-measures the live tokens against WCAG 2.2.
 */
import { Check, Monitor, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { Sparkline } from '@/components/ui/kpi';
import { KpiTile, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useThemeId } from '@/components/charts/echart';
import { useOS } from '@/lib/store';
import { screenBySlug } from '@/lib/supply/screens';
import { themes, type ThemeDef } from '@/lib/themes';
import { cn } from '@/lib/utils';

const screen = screenBySlug('theme-studio')!;

export default function ThemeStudio() {
  const s = useOS();
  const active = useThemeId();
  const reset = () => { s.setTheme('cosmic'); s.setDensity('default'); s.setTextSize('md'); s.setMotion('full'); s.setSidebarCollapsed(false); s.toast('Appearance reset to Audience Orbit X defaults', 'info'); };
  return (
    <div className="space-y-5">
      <SupplyHeader screen={screen} source="live" title="Theme Studio"
        subtitle="Make SUPPLY360 comfortable for the way you work. Changes apply immediately and are saved on this device."
        actions={<Button size="sm" variant="ghost" onClick={reset}><RotateCcw size={13} /> Reset to defaults</Button>} />

      <section aria-labelledby="h-themes">
        <SectionTitle id="h-themes" eyebrow="Six themes" title="Choose a theme" actions={
          <button onClick={() => s.setTheme('system')} aria-pressed={s.theme === 'system'}
            className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-2xs font-semibold', s.theme === 'system' ? 'border-primary/60 text-primary' : 'hairline text-ink-2 hover:text-ink')}>
            <Monitor size={12} /> Follow system {s.theme === 'system' && <Check size={12} />}
          </button>} />
        <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map((t) => <ThemeCard key={t.id} t={t} selected={s.theme === t.id} current={active === t.id} onSelect={() => s.setTheme(t.id)} />)}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="space-y-5 xl:col-span-4">
          <SectionTitle eyebrow="Layout" title="Comfort settings" />
          <Setting stack label="Density" hint="Row and navigation height. Compact fits about 30% more rows in tables.">
            <Segmented label="Density" size="sm" value={s.density} onChange={s.setDensity} options={[{ value: 'compact', label: 'Compact' }, { value: 'default', label: 'Default' }, { value: 'comfortable', label: 'Comfortable' }]} />
          </Setting>
          <Setting stack label="Text size" hint="Scales text set in rem across the app.">
            <Segmented label="Text size" size="sm" value={s.textSize} onChange={s.setTextSize} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Default' }, { value: 'lg', label: 'Large' }]} />
          </Setting>
          <Setting label="Reduce motion" hint="Stops count-ups, chart transitions and drawer slides. Your OS setting is always respected too.">
            <Switch label="Reduce motion" checked={s.motion === 'reduced'} onCheckedChange={(v) => s.setMotion(v ? 'reduced' : 'full')} />
          </Setting>
          <Setting label="Start with a collapsed sidebar" hint="Icons only, with flyouts. Toggle any time with [.">
            <Switch label="Collapsed sidebar" checked={s.sidebarCollapsed} onCheckedChange={s.setSidebarCollapsed} />
          </Setting>
        </Panel>
        <Panel className="xl:col-span-5">
          <SectionTitle eyebrow="Live preview" title="Components in this theme" />
          <Preview />
        </Panel>
        <Panel className="xl:col-span-3">
          <SectionTitle eyebrow="WCAG 2.2" title="Contrast check" />
          <ContrastReport themeKey={`${active}-${s.textSize}`} />
        </Panel>
      </section>
    </div>
  );
}

function Setting({ label, hint, children, stack }: { label: string; hint: string; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', stack && 'flex-col')}>
      <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{label}</div><div className="text-2xs text-ink-3">{hint}</div></div>
      {children}
    </div>
  );
}

/** Each card renders a miniature of the app inside its own data-theme scope, using that theme's real tokens. */
function ThemeCard({ t, selected, current, onSelect }: { t: ThemeDef; selected: boolean; current: boolean; onSelect: () => void }) {
  return (
    <button role="radio" aria-checked={selected} onClick={onSelect}
      className={cn('group overflow-hidden rounded-2xl border text-left transition-[box-shadow,border-color] duration-150', selected ? 'border-primary shadow-glow' : 'hairline hover:border-primary/40')}>
      <div data-theme={t.id} className="relative h-[124px] overflow-hidden p-3" style={{ background: 'rgb(var(--bg))', color: 'rgb(var(--ink))' }}>
        <div className="ambient absolute inset-0" aria-hidden />
        <div className="relative flex h-full gap-2">
          <div className="flex w-10 flex-col gap-1.5 rounded-lg p-1.5" style={{ background: 'rgb(var(--surface) / .7)' }}>
            {[1, 0, 0, 0].map((on, i) => <span key={i} className="h-1.5 rounded-full" style={{ background: on ? 'rgb(var(--primary))' : 'rgb(var(--ink-3) / .35)' }} />)}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="panel flex-1 rounded-lg p-2" style={{ borderRadius: 10 }}>
                  <div className="h-1 w-8 rounded-full" style={{ background: 'rgb(var(--ink-3) / .5)' }} />
                  <div className="mt-1.5 font-jakarta text-[13px] font-bold leading-none">{i ? '41.8%' : '128k'}</div>
                  <Sparkline data={i ? [4, 6, 5, 7, 6, 8, 9] : [3, 4, 6, 5, 7, 8, 7]} color={`rgb(var(--chart-${i + 1}))`} height={14} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md px-2 py-1 text-[9px] font-semibold" style={{ background: 'linear-gradient(90deg, rgb(var(--primary-strong)), rgb(var(--primary-2)))', color: 'rgb(var(--on-primary))' }}>Launch</span>
              <span className="rounded-md px-2 py-1 text-[9px] font-semibold" style={{ background: 'rgb(var(--emerald) / .15)', color: 'rgb(var(--emerald))' }}>Active</span>
              <span className="rounded-md px-2 py-1 text-[9px] font-semibold" style={{ background: 'rgb(var(--danger) / .15)', color: 'rgb(var(--danger))' }}>At risk</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-start justify-between gap-2 border-t hairline bg-surface/60 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold">{t.name} {t.id === 'cosmic' && <Badge tone="purple">Default</Badge>}</div>
          <div className="text-2xs text-ink-3">{t.tagline}</div>
          <div className="mt-0.5 text-2xs text-ink-2">{t.bestFor}</div>
        </div>
        <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border', selected ? 'border-primary bg-primary text-on-primary' : 'hairline')}>{selected && <Check size={12} />}</span>
      </div>
      {current && !selected && <div className="bg-primary/10 px-3 py-1 text-2xs text-primary">Active via system setting</div>}
    </button>
  );
}

function Preview() {
  const [v, setV] = useState('Cardiologists, US + UK, 5+ years');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary">Launch batch</Button>
        <Button size="sm">Secondary</Button>
        <Button size="sm" variant="subtle">Subtle</Button>
        <Button size="sm" variant="ghost">Ghost</Button>
        <Button size="sm" variant="danger">Pause</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(['live', 'soft-launch', 'scheduled', 'paused', 'quota-full', 'at-risk', 'approved', 'ai'] as const).map((st) => <StatusPill key={st} status={st} />)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <KpiTile label="Reachable today" value={146_220} format="int" delta={0.012} spark={[4, 5, 5, 6, 7, 6, 8, 9]} />
        <KpiTile label="Reward liability" value={520_650} format="money" delta={0.022} good="down" spark={[5, 5, 6, 6, 7, 7, 8, 8]} color="rgb(var(--chart-5))" />
      </div>
      <label className="block">
        <span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-ink-3">Audience in plain language</span>
        <input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <div className="overflow-hidden rounded-xl border hairline text-[13px]">
        {[['AR-24137', 'Streaming habits tracker Q4', 'live'], ['AR-24174', 'SMB cloud buyer study', 'soft-launch'], ['AR-24285', 'Oncology nurse workload', 'pending']].map(([id, t, st], i) => (
          <div key={id} className={cn('flex h-row items-center gap-3 px-3', i && 'border-t hairline')}>
            <span className="font-mono text-2xs text-ink-3">{id}</span><span className="flex-1 truncate">{t}</span><StatusPill status={st as 'live'} />
          </div>
        ))}
      </div>
    </div>
  );
}

// WCAG relative luminance and contrast ratio
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function ContrastReport({ themeKey }: { themeKey: string }) {
  const [rows, setRows] = useState<{ label: string; r: number; need: number }[]>([]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string) => cs.getPropertyValue(`--${n}`).trim().split(/\s+/).map(Number);
      const bg = v('bg'), surface = v('surface');
      setRows([
        { label: 'Body text on background', r: ratio(v('ink'), bg), need: 4.5 },
        { label: 'Secondary text on background', r: ratio(v('ink-2'), bg), need: 4.5 },
        { label: 'Muted text on background', r: ratio(v('ink-3'), bg), need: 4.5 },
        { label: 'Muted text on cards', r: ratio(v('ink-3'), surface), need: 4.5 },
        { label: 'Primary as text', r: ratio(v('primary'), bg), need: 4.5 },
        { label: 'Text on primary buttons', r: Math.min(ratio(v('on-primary'), v('primary-strong')), ratio(v('on-primary'), v('primary-2'))), need: 4.5 },
        { label: 'Focus ring vs background', r: ratio(v('focus'), bg), need: 3 },
        { label: 'Danger as text', r: ratio(v('danger'), bg), need: 4.5 },
      ]);
    });
    return () => cancelAnimationFrame(id);
  }, [themeKey]);
  const fails = rows.filter((x) => x.r < x.need).length;
  return (
    <div>
      <p className="mb-3 text-2xs text-ink-3">Measured from this theme’s live tokens. AA needs 4.5:1 for text and 3:1 for focus indicators; AAA needs 7:1.</p>
      <ul className="space-y-1.5">
        {rows.map((x) => (
          <li key={x.label} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="text-ink-2">{x.label}</span>
            <span className="flex items-center gap-1.5">
              <span className="num font-semibold">{x.r.toFixed(1)}:1</span>
              <Badge tone={x.r >= 7 ? 'emerald' : x.r >= x.need ? 'blue' : 'danger'}>{x.r >= 7 ? 'AAA' : x.r >= x.need ? 'AA' : 'Fail'}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 0 && <div className={cn('mt-3 rounded-lg px-2.5 py-2 text-2xs', fails ? 'bg-danger/10 text-danger' : 'bg-emerald/10 text-emerald')}>{fails ? `${fails} pair${fails > 1 ? 's' : ''} below AA in this theme.` : 'Every pair meets WCAG AA.'}</div>}
    </div>
  );
}

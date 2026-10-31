'use client';
import { motion } from 'motion/react';
import { HeartPulse, Lock, PlugZap, ShieldCheck, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { panels, type PanelBrand } from '@/lib/core';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { cn, fmtCompact, fmtMoney, fmtNum, fmtPct, rng, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, DemoBadge, Field, inputCls, PageHeader, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';
import { PanelistDirectory } from '@/components/panels/directory';
import { PanelImport } from '@/components/panels/import';
import { PanelBackendPanel } from '@/components/panels/backend';
import { PanelSyncPanel } from '@/components/panels/sync';

type Sel = 'all' | PanelBrand['id'];
type RewardCat = { id: string; name: string; maxLoi: number; points: number; minQuality: number };

function useSeries(sel: Sel) {
  return useMemo(() => {
    const ps = sel === 'all' ? panels : panels.filter((p) => p.id === sel);
    const scale = sum(ps.map((p) => p.registered)) / 739270;
    const r = rng(ps.length * 31 + (sel === 'all' ? 1 : sel.length));
    const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
    return {
      ps,
      months,
      regs: months.map((_, i) => Math.round((14000 + i * 1200 + r() * 3000) * scale)),
      active: months.map((_, i) => Math.round((228000 + i * 7000 + r() * 6000) * scale)),
      surveys: months.map((_, i) => Math.round((61000 + i * 2400 + r() * 5000) * scale)),
      funnel: [1, 0.62, 0.48, 0.36, 0.27].map((f) => Math.round(sum(ps.map((p) => p.newThisMonth)) * 2.6 * f)),
      ages: ['18–24', '25–34', '35–44', '45–54', '55–64', '65+'].map((a, i) => ({ a, f: Math.round([8, 12, 11, 9, 7, 5][i] * scale * 3100 * (0.9 + r() * 0.2)), m: Math.round([7, 11, 10, 9, 7, 4][i] * scale * 3100 * (0.9 + r() * 0.2)) })),
      quality: Array.from({ length: 10 }, (_, i) => Math.round(Math.exp(-((i - 7.4) ** 2) / 4) * 26000 * scale + r() * 900)),
      cohorts: Array.from({ length: 6 }, (_, c) => Array.from({ length: 6 - c }, (_, m) => +(m === 0 ? 1 : Math.max(0.2, 1 - 0.18 * m - r() * 0.06 - c * 0.01)).toFixed(2))),
    };
  }, [sel]);
}

export default function PanelsPage() {
  const toast = useOS((s) => s.toast);
  const [sel, setSel] = useState<Sel>('all');
  const d = useSeries(sel);
  const [cats, setCats] = useState<RewardCat[]>([
    { id: 'short', name: 'Short reward', maxLoi: 10, points: 50, minQuality: 0.6 },
    { id: 'high', name: 'High reward', maxLoi: 30, points: 250, minQuality: 0.8 },
  ]);
  const [threshold, setThreshold] = useState(1000);
  const [freqCap, setFreqCap] = useState(3);
  const ps = d.ps;

  return (
    <div>
      <PageHeader eyebrow="Proprietary Panel Management" title="Panels" subtitle="Three independent panel identities, managed centrally. Metrics are simulated until each panel's integration adapter is configured."
        actions={<><DemoBadge label="Simulated panel metrics" /><Segmented label="panel" value={sel} onChange={setSel} options={[{ value: 'all', label: 'All panels' }, ...panels.map((p) => ({ value: p.id, label: p.name }))]} /></>} />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {panels.map((p, i) => (
          <motion.button key={p.id} onClick={() => setSel(p.id)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className={cn('panel relative overflow-hidden p-4 text-left transition-shadow', sel === p.id && 'ring-1 ring-inset ring-cyan/50')}>
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-30 blur-2xl" style={{ background: p.color }} />
            <div className="relative flex items-start justify-between gap-2">
              <div><div className="font-display text-base font-bold">{p.name}</div><div className="text-2xs text-ink-3">{p.domain} · {p.focus}</div></div>
              {p.id === 'myhealthopinions' ? <HeartPulse size={18} className="text-emerald" /> : null}
            </div>
            <div className="relative mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div><div className="text-2xs text-ink-3">Registered</div><div className="num font-jakarta font-bold">{fmtCompact(p.registered)}</div></div>
              <div><div className="text-2xs text-ink-3">Active 90d</div><div className="num font-jakarta font-bold">{fmtCompact(p.active)}</div></div>
              <div><div className="text-2xs text-ink-3">Quality</div><div className="num font-jakarta font-bold">{fmtPct(p.avgQuality, 0)}</div></div>
            </div>
            <div className="relative mt-3 flex items-center gap-1.5 text-2xs text-ink-3"><PlugZap size={11} /> Integration: <span className="font-semibold text-orange">{p.integration}</span></div>
          </motion.button>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Registered members" value={sum(ps.map((p) => p.registered))} format={(n) => fmtCompact(n)} delta={0.028} spark={d.active} color="rgb(var(--blue))" />
        <KpiCard label="Active members" value={sum(ps.map((p) => p.active))} format={(n) => fmtCompact(n)} delta={0.034} spark={d.active} />
        <KpiCard label="New registrations" value={sum(ps.map((p) => p.newThisMonth))} format={(n) => fmtNum(n)} delta={0.061} spark={d.regs} color="rgb(var(--purple))" />
        <KpiCard label="Profile completion" value={sum(ps.map((p) => p.profileCompletion * p.registered)) / sum(ps.map((p) => p.registered))} format={(n) => fmtPct(n, 0)} color="rgb(var(--emerald))" />
        <KpiCard label="Monthly churn" value={sum(ps.map((p) => p.churn * p.active)) / sum(ps.map((p) => p.active))} format={(n) => fmtPct(n)} delta={-0.004} deltaGoodWhen="down" color="rgb(var(--orange))" />
        <KpiCard label="Reward liability" value={sum(ps.map((p) => p.rewardLiability))} format={(n) => fmtMoney(n)} status={{ tone: 'warn', text: 'Unredeemed points at par' }} color="rgb(var(--magenta))" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel>
          <PanelHeader eyebrow="Recruitment" title="Recruitment funnel (this month)" />
          <EChart ariaLabel="Recruitment funnel" height={250} deps={[sel]} option={() => ({
            tooltip: { trigger: 'item', formatter: '{b}: {c}' },
            series: [{ type: 'funnel', sort: 'none', gap: 3, minSize: '20%', left: 10, right: 10, top: 4, bottom: 4, label: { color: '#fff', fontSize: 11, formatter: '{b}\n{c}' },
              data: ['Landing visits', 'Sign-up started', 'Email verified', 'Profile 50%+', 'First survey'].map((n, i) => ({ name: n, value: d.funnel[i], itemStyle: { color: [palette.blue, '#3B7BFB', palette.cyan, palette.emerald, palette.purple][i] } })) }],
          })} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Demographics" title="Age and gender pyramid" />
          <EChart ariaLabel="Population pyramid" height={250} deps={[sel]} option={(t) => ({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmtNum(Math.abs(Number(v))) }, legend: { right: 0 },
            grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
            xAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(Math.abs(v)) } },
            yAxis: { type: 'category', data: d.ages.map((x) => x.a), ...axis(t), splitLine: { show: false } },
            series: [
              { name: 'Female', type: 'bar', stack: 'p', barWidth: 14, data: d.ages.map((x) => -x.f), itemStyle: { color: palette.magenta, borderRadius: [4, 0, 0, 4] } },
              { name: 'Male', type: 'bar', stack: 'p', barWidth: 14, data: d.ages.map((x) => x.m), itemStyle: { color: palette.cyan, borderRadius: [0, 4, 4, 0] } },
            ],
          })} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Quality" title="Panelist quality score distribution" />
          <EChart ariaLabel="Quality distribution" height={250} deps={[sel]} option={(t) => ({
            tooltip: { trigger: 'axis' }, grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: d.quality.map((_, i) => `${i * 10}–${i * 10 + 10}`), ...axis(t), splitLine: { show: false } },
            yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(v) } },
            series: [{ type: 'bar', barWidth: '70%', data: d.quality.map((v, i) => ({ value: v, itemStyle: { borderRadius: [4, 4, 0, 0], color: i < 5 ? palette.danger : i < 7 ? palette.orange : palette.emerald } })) }],
          })} />
        </Panel>
        <Panel className="xl:col-span-2">
          <PanelHeader eyebrow="Engagement" title="Active members, registrations and survey participation" />
          <EChart ariaLabel="Engagement trends" height={260} deps={[sel]} option={(t) => ({
            tooltip: { trigger: 'axis' }, legend: { right: 0 },
            xAxis: { type: 'category', data: d.months, ...axis(t), splitLine: { show: false } },
            yAxis: [{ type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(v) } }, { type: 'value', ...axis(t), splitLine: { show: false }, axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(v) } }],
            series: [
              { name: 'Active members', type: 'line', smooth: true, symbol: 'none', data: d.active, lineStyle: { width: 2.5, color: palette.blue }, areaStyle: { color: 'rgba(36,107,253,.15)' } },
              { name: 'Survey starts', type: 'line', smooth: true, symbol: 'none', data: d.surveys, lineStyle: { width: 2, color: palette.cyan } },
              { name: 'New registrations', type: 'bar', yAxisIndex: 1, barWidth: 14, data: d.regs, itemStyle: { color: 'rgba(113,59,255,.6)', borderRadius: [4, 4, 0, 0] } },
            ],
          })} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Retention" title="Monthly cohort retention" />
          <EChart ariaLabel="Cohort retention heatmap" height={260} deps={[sel]} option={(t) => ({
            tooltip: { formatter: (p: unknown) => { const v = (p as { data: number[] }).data; return `Cohort ${d.months[v[1]]} · month ${v[0]}: ${(v[2] * 100).toFixed(0)}%`; } },
            grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'], ...axis(t), splitLine: { show: false } },
            yAxis: { type: 'category', data: d.months, inverse: true, ...axis(t), splitLine: { show: false } },
            visualMap: { show: false, min: 0.2, max: 1, inRange: { color: ['#1B2A5C', palette.purple, palette.cyan] } },
            series: [{ type: 'heatmap', label: { show: true, color: '#fff', fontSize: 10, formatter: (p: unknown) => `${Math.round((p as { data: number[] }).data[2] * 100)}` }, itemStyle: { borderColor: t === 'dark' ? '#080D1F' : '#F4F6FC', borderWidth: 2, borderRadius: 4 },
              data: d.cohorts.flatMap((row, c) => row.map((v, m) => [m, c, v])) }],
          })} />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel>
          <PanelHeader eyebrow="Reward policy" title="Configurable reward categories" actions={<Badge tone="cyan">Not hard-coded</Badge>} />
          <div className="space-y-3">
            {cats.map((c, i) => (
              <div key={c.id} className="panel-solid grid grid-cols-3 gap-2 p-3">
                <div className="col-span-3 text-[12.5px] font-semibold">{c.name}</div>
                <Field label="Max LOI"><input type="number" className={inputCls} value={c.maxLoi} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, maxLoi: +e.target.value } : x)))} /></Field>
                <Field label="Points"><input type="number" className={inputCls} value={c.points} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, points: +e.target.value } : x)))} /></Field>
                <Field label="Min quality"><input type="number" step={0.05} className={inputCls} value={c.minQuality} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, minQuality: +e.target.value } : x)))} /></Field>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Redemption threshold (pts)"><input type="number" className={inputCls} value={threshold} onChange={(e) => setThreshold(+e.target.value)} /></Field>
              <Field label="Max surveys / member / week"><input type="number" className={inputCls} value={freqCap} onChange={(e) => setFreqCap(+e.target.value)} /></Field>
            </div>
            <Button size="sm" variant="primary" className="w-full" onClick={() => toast('Reward policy saved as draft v2 (demo). Applies after admin approval.')}>Save policy draft</Button>
          </div>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="AI panel automation" title="Engagement automations" actions={<DemoBadge />} />
          <ul className="space-y-2 text-[12.5px]">
            {[
              ['Profile completion reminders', 'Members < 60% complete, every 7 days', 'On'],
              ['Survey matching', 'Profile + quota fit, privacy-preserving for health', 'On'],
              ['Inactivity detection', 'No activity 60 days → re-engagement', 'On'],
              ['Re-engagement campaign', '18,400 recipients · needs approval', 'Approval'],
              ['Duplicate account review', 'Device + email similarity → manual queue', 'On'],
              ['Reward eligibility checks', `Quality ≥ category min · ≥ ${threshold} pts to redeem`, 'On'],
              ['Participation frequency control', `${freqCap} invites / member / week`, 'On'],
            ].map(([n, d2, st]) => (
              <li key={n} className="flex items-start justify-between gap-3 border-b hairline pb-2 last:border-0">
                <span><span className="block font-medium">{n}</span><span className="block text-2xs text-ink-3">{d2}</span></span>
                <Badge tone={st === 'On' ? 'emerald' : 'orange'} dot>{st}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="MyHealthOpinions" title="Healthcare safeguards" actions={<ShieldCheck size={16} className="text-emerald" />} />
          <div className="space-y-3 text-[12.5px]">
            {[
              ['Healthcare professionals', 'Credential verification, specialty profiling, separate consent for HCP research', 'emerald'],
              ['Patients', 'Explicit consent per condition category; condition data stored encrypted in a separate schema', 'cyan'],
              ['Caregivers', 'Consent scoped to caregiver role; no patient identifiers collected', 'purple'],
            ].map(([t, b, c]) => (
              <div key={t} className="panel-solid p-3"><div className="flex items-center gap-2 font-semibold"><span className={cn('h-2 w-2 rounded-full', c === 'emerald' ? 'bg-emerald' : c === 'cyan' ? 'bg-cyan' : 'bg-purple')} />{t}</div><div className="mt-1 text-2xs text-ink-3">{b}</div></div>
            ))}
            <p className="flex gap-2 text-2xs text-ink-3"><Lock size={12} className="mt-0.5 shrink-0" /> Survey matching uses eligibility flags, not raw health data. No real health information exists in this demo.</p>
          </div>
        </Panel>
      </div>

      <PanelistDirectory />

      <PanelBackendPanel />
      <PanelSyncPanel />

      <Panel className="mt-6">
        <PanelHeader eyebrow="Integration" title="Connect existing panel websites" actions={<Badge tone="orange">Adapters not connected</Badge>} />
        <div className="grid gap-4 text-[12.5px] md:grid-cols-3">
          <div className="panel-solid p-4"><div className="mb-1 font-semibold">1. Secure file import</div><PanelImport /></div>
          <div className="panel-solid p-4"><div className="mb-1 font-semibold">2. Panel backend adapter</div><p className="text-2xs text-ink-3">Built for the Turn2Opinion backend API (above). Active per panel once its URL and app token are configured; verified against a local stand-in only so far.</p></div>
          <div className="panel-solid p-4"><div className="mb-1 font-semibold">3. Event sync</div><p className="text-2xs text-ink-3">Survey invitations, completes and reward ledger posted back to each panel. Planned with the panel adapters (not connected).</p></div>
        </div>
      </Panel>
    </div>
  );
}

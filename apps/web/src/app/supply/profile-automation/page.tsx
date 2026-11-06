'use client';
/**
 * Screen 9 · Profile Completion Automation. A gap heatmap (attribute × panel) is the hero: pick a
 * cell to set up a nudge for exactly the members missing that attribute. Progressive-profiling rules
 * run continuously and can be switched off; the lift chart shows what nudges achieved.
 */
import { Megaphone, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Bar, Button, Panel, Segmented } from '@/components/ui/primitives';
import { ConfirmDialog, Switch } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { panelBrands, panelStats } from '@/lib/supply/demo';
import { screenBySlug } from '@/lib/supply/screens';
import { fmtCompact, fmtNum } from '@/lib/utils';

const screen = screenBySlug('profile-automation')!;
const attrs = ['Household income', 'Education', 'Household size', 'Children in home', 'Vehicle ownership', 'Job role', 'Company size', 'Industry', 'Specialty', 'Conditions', 'Media habits', 'Shopping channels'];
// share of active members missing each attribute, per panel (synthetic)
const gaps = [
  [0.22, 0.31, 0.12], [0.18, 0.26, 0.08], [0.35, 0.41, 0.3], [0.29, 0.33, 0.27], [0.44, 0.48, 0.52], [0.38, 0.52, 0.21],
  [0.47, 0.6, 0.55], [0.4, 0.55, 0.18], [0.92, 0.95, 0.09], [0.71, 0.74, 0.16], [0.26, 0.21, 0.58], [0.33, 0.19, 0.62],
];
type Campaign = { id: string; attr: string; panel: string; size: number; channel: string; points: number; progress: number };

export default function ProfileAutomation() {
  const toast = useOS((s) => s.toast);
  const [cell, setCell] = useState<{ a: number; p: number }>({ a: 6, p: 1 });
  const [channel, setChannel] = useState<'card' | 'email' | 'both'>('card');
  const [points, setPoints] = useState(50);
  const [confirm, setConfirm] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([
    { id: 'c1', attr: 'Household size', panel: 'T2O', size: 128_400, channel: 'Survey card', points: 25, progress: 0.62 },
    { id: 'c2', attr: 'Specialty', panel: 'MHO', size: 8_900, channel: 'Email', points: 100, progress: 0.38 },
  ]);
  const [rules, setRules] = useState([
    { id: 'r1', name: 'Ask one missing question after every completed survey', on: true, lift: '+2.1 pts / month' },
    { id: 'r2', name: 'Re-ask attributes older than 12 months (income, employment)', on: true, lift: 'keeps 94% current' },
    { id: 'r3', name: 'Screen-out recovery: offer a 2-question profiler instead', on: false, lift: 'est. +0.8 pts / month' },
    { id: 'r4', name: 'Pause nudges for members invited 3+ times this week', on: true, lift: 'fatigue guard' },
  ]);
  const p = panelStats[cell.p];
  const gap = gaps[cell.a][cell.p];
  const size = Math.round(p.active30 * gap);
  const expected = Math.round(size * (channel === 'both' ? 0.34 : channel === 'card' ? 0.27 : 0.18) * (1 + points / 400));

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source="demo" title="Profile completion" subtitle="Find the profiling gaps that limit reach, and close them with targeted nudges instead of blanket emails." />
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="min-w-0 xl:col-span-8">
          <SectionTitle eyebrow="Gap map · share of active members missing an attribute" title="Pick a cell to target it" />
          <EChart ariaLabel="Heatmap of missing profile attributes by panel. Select a cell to plan a nudge." height={420} deps={[cell.a, cell.p]}
            onClick={(e) => { const d = e.data as number[]; setCell({ a: d[1], p: d[0] }); }}
            option={(t) => ({
              tooltip: { formatter: (q: unknown) => { const d = (q as { data: number[] }).data; return `${attrs[d[1]]} · ${panelBrands[d[0]].short}: ${Math.round(d[2] * 100)}% missing`; } },
              grid: { left: 8, right: 8, top: 8, bottom: 44, containLabel: true },
              xAxis: { type: 'category', data: panelBrands.map((b) => b.name), ...axis(t, { splitLine: { show: false } }) },
              yAxis: { type: 'category', data: attrs, inverse: true, ...axis(t, { splitLine: { show: false } }) },
              visualMap: { min: 0, max: 1, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, itemWidth: 10, inRange: { color: ['rgba(30,205,155,.25)', 'rgba(255,199,84,.7)', 'rgba(255,98,126,.9)'] }, formatter: (v: unknown) => `${Math.round(Number(v) * 100)}%`, textStyle: { fontSize: 10 } },
              series: [{
                type: 'heatmap', data: gaps.flatMap((row, a) => row.map((v, pi) => [pi, a, v])),
                label: { show: true, fontSize: 10.5, formatter: (q: unknown) => `${Math.round((q as { data: number[] }).data[2] * 100)}%` },
                itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: 'rgba(0,0,0,0)' },
                emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } },
              }],
            })} />
          <p className="text-2xs text-ink-3">Grey cells like Specialty for consumer panels are expected gaps; they only matter for B2B and healthcare members.</p>
        </Panel>

        <Panel className="space-y-4 xl:col-span-4">
          <SectionTitle eyebrow="Nudge" title={`${attrs[cell.a]} · ${p.short}`} />
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">Members missing it</div><div className="num font-jakarta text-lg font-bold">{fmtCompact(size)}</div></div>
            <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">Expected answers</div><div className="num font-jakarta text-lg font-bold text-emerald">{fmtCompact(expected)}</div></div>
          </div>
          <label className="block"><span className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-ink-3">Channel</span>
            <Segmented label="Channel" size="sm" value={channel} onChange={setChannel} options={[{ value: 'card', label: 'Survey card' }, { value: 'email', label: 'Email' }, { value: 'both', label: 'Both' }]} />
          </label>
          <label className="block"><span className="mb-1.5 flex justify-between text-2xs font-semibold uppercase tracking-wider text-ink-3">Reward <span className="num normal-case tracking-normal text-ink">{points} points</span></span>
            <input type="range" min={0} max={200} step={25} value={points} onChange={(e) => setPoints(Number(e.target.value))} className="w-full accent-[rgb(var(--primary))]" />
            <span className="text-2xs text-ink-3">Cost if all answer: {fmtNum(Math.round((expected * points) / 100))} USD</span>
          </label>
          <p className="rounded-lg bg-purple/10 p-2.5 text-2xs text-ink-2"><Sparkles size={11} className="mr-1 inline text-purple" />Suggestion: survey cards convert 1.5× better than email for this attribute, and members invited 3+ times this week are skipped automatically.</p>
          <Button variant="primary" size="sm" className="w-full" disabled={size === 0} onClick={() => setConfirm(true)}><Megaphone size={13} /> Launch nudge</Button>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-5">
          <SectionTitle eyebrow="Running" title="Nudge campaigns" />
          <ul className="space-y-2.5">
            {campaigns.map((c) => (
              <li key={c.id} className="panel-solid p-3 text-[12.5px]">
                <div className="flex items-center gap-2"><span className="flex-1 font-medium">{c.attr} · {c.panel}</span><StatusPill status="live" /></div>
                <div className="mt-0.5 text-2xs text-ink-3">{fmtNum(c.size)} members · {c.channel} · {c.points} points</div>
                <Bar value={c.progress} tone="emerald" className="mt-2" /><div className="mt-1 text-2xs text-ink-3">{Math.round(c.progress * 100)}% sent</div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="xl:col-span-4">
          <SectionTitle eyebrow="Always on" title="Progressive profiling rules" />
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.id} className="flex items-start gap-3">
                <Switch label={r.name} checked={r.on} onCheckedChange={(on) => { setRules(rules.map((x) => (x.id === r.id ? { ...x, on } : x))); toast(`${on ? 'Enabled' : 'Paused'}: ${r.name}`, 'info'); }} />
                <span className="text-[12.5px]"><span className={r.on ? '' : 'text-ink-3'}>{r.name}</span><span className="block text-2xs text-ink-3">{r.lift}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="xl:col-span-3">
          <SectionTitle eyebrow="Lift" title="Avg. profile completion" />
          <EChart ariaLabel="Average profile completion over the last 8 weeks per panel" height={190} option={(t) => ({
            tooltip: { trigger: 'axis' }, grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: ['W38', 'W39', 'W40', 'W41', 'W42', 'W43', 'W44', 'W45'], ...axis(t, { splitLine: { show: false } }) }, yAxis: { type: 'value', min: 55, max: 90, ...axis(t) },
            series: panelBrands.map((b, i) => ({ type: 'line', name: b.short, symbol: 'none', smooth: true, data: [0, 1, 2, 3, 4, 5, 6, 7].map((w) => [66, 61, 80][i] + w * [1.1, 0.9, 0.7][i]), itemStyle: { color: b.color } })),
          })} />
          <Badge tone="emerald" className="mt-2">+7.4 pts in 8 weeks (T2O)</Badge>
        </Panel>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="primary" title={`Nudge ${fmtNum(size)} ${p.short} members?`} confirmLabel="Launch nudge"
        body={<>Ask for <b>{attrs[cell.a]}</b> by {channel === 'both' ? 'survey card and email' : channel === 'card' ? 'survey card' : 'email'}, rewarding {points} points. Only members who allow marketing email get the email. Demo: nothing is sent.</>}
        onConfirm={() => { setCampaigns([{ id: Date.now().toString(36), attr: attrs[cell.a], panel: p.short, size, channel: channel === 'card' ? 'Survey card' : channel === 'email' ? 'Email' : 'Card + email', points, progress: 0.02 }, ...campaigns]); toast('Nudge launched'); }} />
    </div>
  );
}

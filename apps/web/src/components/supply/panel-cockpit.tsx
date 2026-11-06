'use client';
/**
 * Screens 3–5 · Panel cockpits. Each panel keeps its own brand colour and gets a module that fits
 * how it works: Turn2Opinion (recruitment and survey cards), MyFrequentRewards (loyalty tiers and
 * points economy), MyHealthOpinions (specialty coverage and credential checks).
 */
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Bar, Button, Panel, buttonVariants } from '@/components/ui/primitives';
import { StatusPill } from '@/components/ui/status';
import { KpiTile, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { SupplyOrbit } from '@/components/supply/orbit';
import { useOS } from '@/lib/store';
import { loadPanelStats, useSupplyData } from '@/lib/supply/data';
import { panelStats, type PanelId } from '@/lib/supply/demo';
import { COUNTRY_CODES, SCALE, SPECIALTIES, panellists } from '@/lib/supply/panellists';
import { screenBySlug } from '@/lib/supply/screens';
import { rng, fmtCompact, fmtNum, cn } from '@/lib/utils';

const slugOf: Record<PanelId, string> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };

export function PanelCockpit({ id }: { id: PanelId }) {
  const screen = screenBySlug(slugOf[id])!;
  const stats = useSupplyData('cockpit:panels', () => panelStats, loadPanelStats);
  const p = stats.data.find((x) => x.id === id)!;
  const members = panellists().filter((x) => x.brand === id);
  const r = useMemo(() => rng(id.charCodeAt(0) * 31), [id]);
  const weeks = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ w: `W${34 + i}`, joins: Math.round(p.members * 0.006 * (0.8 + r() * 0.4)), churn: Math.round(p.members * 0.003 * (0.8 + r() * 0.5)) })), [p.members, r]);
  const stages = [
    { key: 'reg', label: 'Members', value: p.members, color: 'var(--chart-1)' },
    { key: 'ver', label: 'Verified', value: p.verified, color: 'var(--chart-2)' },
    { key: 'pro', label: 'Profile ≥ 80%', value: Math.round(p.members * p.profileCompletion * 0.78), color: 'var(--chart-3)' },
    { key: 'act', label: 'Active 30 days', value: p.active30, color: 'var(--chart-4)' },
  ];
  return (
    <div className="space-y-4">
      <div className="h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${p.color}, transparent)` }} aria-hidden />
      <SupplyHeader screen={screen} source={stats.source === 'live' ? 'mixed' : 'demo'} title={<span className="flex items-center gap-3"><span className="h-3 w-3 rounded-full" style={{ background: p.color }} aria-hidden />{p.name}</span>}
        subtitle={p.focus}
        actions={<Link href={`/supply/panellists`} className={buttonVariants({ size: 'sm' })}>Browse members</Link>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Members" value={p.members} format="compact" color={p.color} spark={p.trend} />
        <KpiTile label="Active 30d" value={p.active30 / p.members} format="pct" delta={0.018} />
        <KpiTile label="Verified" value={p.verified / p.members} format="pct" delta={0.006} />
        <KpiTile label="Profile completion" value={p.profileCompletion} format="pct" delta={0.011} />
        <KpiTile label="Completion rate" value={p.completionRate} format="pct" delta={-0.004} />
        <KpiTile label="Reward liability" value={p.rewardLiability} format="money" delta={0.02} good="down" />
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-5"><SectionTitle eyebrow="Membership" title="Funnel" /><SupplyOrbit stages={stages} size={220} /></Panel>
        <Panel className="xl:col-span-7">
          <SectionTitle eyebrow="Last 12 weeks" title="Joins and churn" />
          <EChart ariaLabel={`Weekly joins and churn for ${p.name}`} height={230} option={(t) => ({
            legend: {}, tooltip: { trigger: 'axis' }, grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: weeks.map((w) => w.w), ...axis(t, { splitLine: { show: false } }) }, yAxis: { type: 'value', ...axis(t) },
            series: [
              { type: 'bar', name: 'Joins', data: weeks.map((w) => w.joins), barWidth: 12, itemStyle: { color: p.color, borderRadius: [4, 4, 0, 0] } },
              { type: 'line', name: 'Churn', data: weeks.map((w) => w.churn), symbolSize: 5, itemStyle: { color: 'rgb(var(--danger))' } },
            ],
          })} />
        </Panel>
      </div>
      {id === 't2o' && <T2OModule color={p.color} />}
      {id === 'mfr' && <MFRModule color={p.color} members={members.length} />}
      {id === 'mho' && <MHOModule color={p.color} />}
    </div>
  );
}

function T2OModule({ color }: { color: string }) {
  const sources = [
    ['Paid social', 18_420, 0.71, 3.1, 0.34], ['Search', 11_240, 0.83, 4.4, 0.41], ['Referral', 6_310, 0.9, 1.2, 0.52], ['Partner sites', 9_870, 0.64, 2.6, 0.27], ['Organic', 4_120, 0.88, 0, 0.47],
  ] as const;
  const cards = [['Top slot', 0.31], ['Slot 2', 0.22], ['Slot 3', 0.15], ['Slot 4', 0.09], ['Below fold', 0.04]] as const;
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Panel className="xl:col-span-7">
        <SectionTitle eyebrow="Recruitment · 30 days" title="Where members come from" />
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[12.5px]">
          <thead><tr className="text-left text-2xs uppercase tracking-wider text-ink-3"><th className="py-1.5">Source</th><th className="text-right">Sign-ups</th><th className="w-40 pl-4">Verified</th><th className="text-right">Cost / verified</th><th className="text-right">Active 30d</th></tr></thead>
          <tbody>{sources.map(([s, n, v, cpa, a]) => (
            <tr key={s} className="h-row border-t hairline"><td>{s}</td><td className="num text-right">{fmtNum(n)}</td><td className="pl-4"><span className="flex items-center gap-2"><Bar value={v} tone={v > 0.8 ? 'emerald' : 'orange'} className="h-1" /><span className="num w-8 text-2xs">{Math.round(v * 100)}%</span></span></td><td className="num text-right">{cpa ? `$${cpa.toFixed(2)}` : '—'}</td><td className="num text-right">{Math.round(a * 100)}%</td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <Panel className="xl:col-span-5">
        <SectionTitle eyebrow="Survey cards" title="Click-through by position" />
        <ul className="space-y-2">{cards.map(([s, ctr]) => <li key={s}><div className="flex justify-between text-[12.5px]"><span>{s}</span><span className="num font-semibold">{(ctr * 100).toFixed(0)}%</span></div><div className="mt-1 h-2 rounded-full bg-ink-3/12"><div className="h-full rounded-full" style={{ width: `${ctr * 300}%`, background: color }} /></div></li>)}</ul>
        <p className="mt-3 text-2xs text-ink-3">Cards in the top two slots get 53% of clicks. Routing (wave 3) decides which survey takes the top slot for each member.</p>
      </Panel>
    </div>
  );
}

function MFRModule({ color, members }: { color: string; members: number }) {
  const tiers = [['Platinum', 0.04, '#B9C4D6'], ['Gold', 0.13, '#E8B84A'], ['Silver', 0.31, '#9AA7BC'], ['Bronze', 0.52, '#C0855A']] as const;
  const months = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Panel className="xl:col-span-5">
        <SectionTitle eyebrow="Loyalty" title="Tier pyramid" />
        <div className="flex flex-col items-center gap-1.5 py-2" role="list" aria-label="Members by tier">
          {tiers.map(([t, share, c], i) => (
            <div key={t} role="listitem" className="flex h-10 items-center justify-between rounded-lg px-3 text-[12.5px] font-semibold text-black/80" style={{ width: `${40 + i * 20}%`, background: c }}>
              <span>{t}</span><span className="num">{fmtCompact(Math.round(share * members * SCALE))}</span>
            </div>
          ))}
        </div>
        <p className="text-2xs text-ink-3">Tier is earned by completes in the last 90 days. Gold and above get early access to high-reward surveys.</p>
      </Panel>
      <Panel className="xl:col-span-7">
        <SectionTitle eyebrow="Points economy" title="Earned vs redeemed (millions of points)" actions={<Link href="/supply/rewards" className="text-2xs font-semibold text-primary hover:underline">Wallets</Link>} />
        <EChart ariaLabel="Points earned versus redeemed by month" height={220} option={(t) => ({
          legend: {}, tooltip: { trigger: 'axis' }, grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
          xAxis: { type: 'category', data: months, ...axis(t, { splitLine: { show: false } }) }, yAxis: { type: 'value', ...axis(t) },
          series: [
            { type: 'bar', name: 'Earned', data: [41, 44, 47, 46, 52, 55], barWidth: 14, itemStyle: { color, borderRadius: [4, 4, 0, 0] } },
            { type: 'bar', name: 'Redeemed', data: [33, 36, 35, 41, 43, 46], barWidth: 14, itemStyle: { color: 'rgb(var(--chart-5))', borderRadius: [4, 4, 0, 0] } },
          ],
        })} />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[['Weekly streak ≥ 4', '28%'], ['Avg. redemption', '$14.20'], ['Breakage (12m)', '6.1%']].map(([k, v]) => <div key={k} className="panel-solid p-2"><div className="text-2xs text-ink-3">{k}</div><div className="num font-semibold">{v}</div></div>)}
        </div>
      </Panel>
    </div>
  );
}

function MHOModule({ color }: { color: string }) {
  const toast = useOS((s) => s.toast);
  const hcps = panellists().filter((p) => p.brand === 'mho' && p.segment === 'hcp');
  const countries = COUNTRY_CODES.slice(0, 8);
  const specs = SPECIALTIES.slice();
  const data: [number, number, number][] = [];
  specs.forEach((s, y) => countries.forEach((c, x) => data.push([x, y, Math.round(hcps.filter((p) => p.specialty === s && p.country === c).length * SCALE)])));
  const max = Math.max(1, ...data.map((d) => d[2]));
  const [queue, setQueue] = useState(() => hcps.filter((p) => p.verified.credential === false).slice(0, 6));
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Panel className="xl:col-span-7">
        <SectionTitle eyebrow="Coverage" title="Healthcare professionals by specialty and country" />
        <EChart ariaLabel="Heatmap of healthcare professionals by specialty and country" height={300} option={(t) => ({
          tooltip: { formatter: (q: unknown) => { const d = (q as { data: number[] }).data; return `${specs[d[1]]} · ${countries[d[0]]}: ${fmtNum(d[2])}`; } },
          grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
          xAxis: { type: 'category', data: countries, ...axis(t, { splitLine: { show: false } }) }, yAxis: { type: 'category', data: specs, ...axis(t, { splitLine: { show: false } }) },
          visualMap: { min: 0, max, show: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, itemWidth: 10, inRange: { color: ['rgba(16,185,129,0.06)', color] }, textStyle: { fontSize: 10 } },
          series: [{ type: 'heatmap', data, itemStyle: { borderRadius: 3, borderWidth: 2, borderColor: 'transparent' } }],
        })} />
      </Panel>
      <Panel className="xl:col-span-5">
        <SectionTitle eyebrow="Compliance" title="Credential checks waiting" actions={<Badge tone="warn" dot>{queue.length}</Badge>} />
        {queue.length === 0 ? <p className="py-8 text-center text-[13px] text-ink-3">All credentials reviewed.</p> : (
          <ul className="space-y-2">
            {queue.map((p) => (
              <li key={p.id} className="panel-solid flex items-center gap-3 p-2.5 text-[12.5px]">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.handle}</span><span className="text-2xs text-ink-3">{p.specialty} · {p.country} · {p.yearsPractice}y · licence registry match {70 + (p.handle.length % 25)}%</span></span>
                <Button size="icon-sm" variant="success" aria-label={`Approve ${p.handle}`} onClick={() => { setQueue(queue.filter((x) => x.id !== p.id)); toast(`${p.handle} credential verified`); }}><Check size={13} /></Button>
                <Button size="icon-sm" variant="danger" aria-label={`Reject ${p.handle}`} onClick={() => { setQueue(queue.filter((x) => x.id !== p.id)); toast(`${p.handle} credential rejected`, 'warn'); }}><X size={13} /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5 text-2xs"><StatusPill status="active" label="Honoraria within caps" /><StatusPill status="pending" label="2 countries need FMV review" /></div>
        <p className={cn('mt-2 text-2xs text-ink-3')}>Health data consent is required before any healthcare profiling question is shown.</p>
      </Panel>
    </div>
  );
}

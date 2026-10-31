'use client';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { BadgeCheck, Lock, ShieldAlert, Sparkles } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { countries, countryByCode, vendors, type Vendor } from '@/lib/demo/data';
import { allocate, defaultWeights, rankVendors, type Audience, type Weights } from '@/lib/pricing';
import { can } from '@/lib/roles';
import { useOS } from '@/lib/store';
import { palette, series } from '@/lib/tokens';
import { avg, cn, fmtCompact, fmtMoney, fmtNum, fmtPct, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Bar, Button, DemoBadge, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader, SearchInput } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';

const OWN_VENDOR = 'vd-01'; // the vendor persona's own company in demo

function VendorSelection() {
  const approve = useOS((s) => s.toast);
  const [audience, setAudience] = useState<Audience>('B2B');
  const [country, setCountry] = useState('US');
  const [n, setN] = useState(400);
  const [ir, setIr] = useState(0.2);
  const [w, setW] = useState<Weights>(defaultWeights);
  const q = { audience, country, n, ir, loi: 15, deadlineDays: 14 };
  const ranked = useMemo(() => rankVendors(q, w), [audience, country, n, ir, w]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => allocate(q, ranked), [ranked]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels: Record<keyof Weights, string> = { cpi: 'Price (CPI)', quality: 'Quality', reliability: 'Delivery reliability', response: 'Response rate', coverage: 'Market coverage', speed: 'Speed' };
  const colors: Record<keyof Weights, string> = { cpi: palette.cyan, quality: palette.emerald, reliability: palette.blue, response: palette.purple, coverage: palette.orange, speed: palette.magenta };
  return (
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Audience"><select className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>{['B2C', 'B2B', 'Healthcare'].map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Country"><select className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
          <Field label="Completes"><input type="number" className={inputCls} value={n} onChange={(e) => setN(Math.max(1, +e.target.value))} /></Field>
          <Field label="Incidence"><input type="number" step={0.01} className={inputCls} value={ir} onChange={(e) => setIr(Math.min(1, Math.max(0.01, +e.target.value)))} /></Field>
        </div>
        <div className="eyebrow pt-2">Decision weights</div>
        {(Object.keys(w) as (keyof Weights)[]).map((k) => (
          <label key={k} className="block text-[12px]">
            <span className="flex justify-between text-ink-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colors[k] }} />{labels[k]}</span><span className="num">{Math.round(w[k] * 100)}</span></span>
            <input type="range" min={0} max={0.6} step={0.05} value={w[k]} onChange={(e) => setW({ ...w, [k]: +e.target.value })} className="w-full accent-cyan" />
          </label>
        ))}
      </div>
      <div className="min-w-0 space-y-4">
        {!ranked.length ? <EmptyState title="No eligible vendors" body="No vendor in the exchange covers this audience in this market." /> : (
          <>
            <EChart ariaLabel="Vendor score breakdown" height={Math.max(160, ranked.length * 34 + 40)} deps={[ranked]} option={(t) => ({
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => Number(v).toFixed(3) },
              legend: { right: 0, type: 'scroll' }, grid: { left: 8, right: 16, top: 30, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axis(t) }, yAxis: { type: 'category', inverse: true, data: ranked.map((r) => r.vendor.name), ...axis(t), splitLine: { show: false } },
              series: (Object.keys(w) as (keyof Weights)[]).map((k) => ({ name: labels[k], type: 'bar', stack: 's', barWidth: 14, itemStyle: { color: colors[k] }, data: ranked.map((r) => +(r.parts[k] / Object.values(w).reduce((a, b) => a + b, 0)).toFixed(3)) })),
            })} />
            <div className="panel-solid p-4 text-[12.5px]">
              <div className="mb-2 flex items-center gap-2 font-semibold"><Sparkles size={14} className="text-cyan" /> Recommendation and why</div>
              <p className="text-ink-2">
                <b className="text-ink">{ranked[0].vendor.name}</b> ranks first with a score of {ranked[0].score.toFixed(2)}. Its strongest factors are{' '}
                {(Object.entries(ranked[0].parts) as [keyof Weights, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => labels[k].toLowerCase()).join(' and ')}; estimated CPI ${ranked[0].cpi.toFixed(2)} with {fmtPct(ranked[0].vendor.quality)} quality history.
                {plan.lines.length > 1 && ` Capacity suggests splitting across ${plan.lines.length} vendors.`}
              </p>
              <div className="mt-3 space-y-1">
                {plan.lines.map((l) => <div key={l.vendor.id} className="num flex justify-between"><span>{l.vendor.name}</span><span>{l.completes} completes · ${l.cpi.toFixed(2)}</span></div>)}
                {plan.shortfall > 0 && <div className="text-orange">Shortfall {plan.shortfall}: estimated capacity is insufficient.</div>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => approve('Purchase order sent for approval (Automation → Approvals). Nothing is issued without sign-off.', 'info')}>Request PO approval</Button>
                <span className="text-2xs text-ink-3">Estimates from rate cards. Binding POs require human approval.</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VendorProfile({ v }: { v: Vendor }) {
  const peers = vendors;
  const dims = [['Quality', 'quality'], ['Reliability', 'reliability'], ['Response', 'responseRate'], ['Speed', 'speed'], ['Win rate', 'bidWinRate']] as const;
  const maxOf = (k: (typeof dims)[number][1]) => Math.max(...peers.map((p) => p[k]));
  return (
    <EChart ariaLabel={`${v.name} performance radar`} height={260} deps={[v.id]} option={(t) => ({
      tooltip: {}, legend: { bottom: 0, top: 'auto' },
      radar: { indicator: dims.map(([n, k]) => ({ name: n, max: maxOf(k) })), radius: '62%', axisName: { color: t === 'dark' ? '#A8B4D6' : '#425078', fontSize: 10.5 }, splitLine: { lineStyle: { color: t === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(16,25,54,.1)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: t === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(16,25,54,.1)' } } },
      series: [{ type: 'radar', symbol: 'none', data: [
        { name: v.name, value: dims.map(([, k]) => v[k]), areaStyle: { color: 'rgba(24,215,242,.25)' }, lineStyle: { color: palette.cyan, width: 2 } },
        { name: 'Exchange average', value: dims.map(([, k]) => avg(peers.map((p) => p[k]))), lineStyle: { color: palette.purple, type: 'dashed' }, areaStyle: { color: 'rgba(113,59,255,.08)' } },
      ] }],
    })} />
  );
}

function MarketInner() {
  const s = useOS();
  const params = useSearchParams();
  const isVendor = s.role === 'vendor';
  const seeAll = can(s.role, 'view:vendor_bids');
  const visible = isVendor ? vendors.filter((v) => v.id === OWN_VENDOR) : vendors;
  const [sel, setSel] = useState<string>(params.get('vendor') ?? visible[0].id);
  const [q, setQ] = useState('');
  const v = visible.find((x) => x.id === sel) ?? visible[0];
  const filtered = visible.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  const live = s.projects.filter((p) => ['Sample Allocation', 'Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
  const opportunities = s.opportunities.filter((o) => ['Feasibility', 'Quote Sent'].includes(o.stage));

  return (
    <div>
      <PageHeader eyebrow="Sample Marketplace & Supplier Exchange" title={isVendor ? `${v.name} · Vendor workspace` : 'Sample Exchange'}
        subtitle={isVendor ? 'Your opportunities, allocations, quality and payments. Competing vendors’ bids are never visible here.' : 'Supplier performance, coverage, CPI and explainable AI allocation across the global exchange.'}
        actions={<DemoBadge />} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label={isVendor ? 'Open opportunities' : 'Active vendors'} value={isVendor ? opportunities.length : visible.filter((x) => x.activeAllocations).length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="Active allocations" value={sum(visible.map((x) => x.activeAllocations))} format={(n) => fmtNum(n)} />
        <KpiCard label="Delivered completes" value={sum(visible.map((x) => x.delivered))} format={(n) => fmtCompact(n)} delta={0.07} color="rgb(var(--cyan))" />
        <KpiCard label="Avg quality score" value={avg(visible.map((x) => x.quality))} format={(n) => fmtPct(n)} color="rgb(var(--emerald))" />
        <KpiCard label={isVendor ? 'Bid conversion' : 'Avg bid win rate'} value={avg(visible.map((x) => x.bidWinRate))} format={(n) => fmtPct(n, 0)} color="rgb(var(--purple))" />
        <KpiCard label="Pending payments" value={sum(visible.map((x) => x.pendingPayment))} format={(n) => fmtMoney(n)} color="rgb(var(--orange))" />
      </div>

      {!isVendor && (
        <Panel className="mb-6">
          <PanelHeader eyebrow="AI vendor selection" title="Explainable allocation recommendation" actions={<Badge tone="purple"><Sparkles size={10} /> Weighted scoring model</Badge>} />
          <VendorSelection />
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader eyebrow="Supply coverage" title="Geographic supply heatmap (quality-weighted)" actions={<DemoBadge />} />
          <EChart ariaLabel="Vendor by country coverage heatmap" height={Math.max(220, visible.length * 30 + 70)} deps={[visible]} option={(t) => ({
            tooltip: { formatter: (p: unknown) => { const d = (p as { data: [number, number, number] }).data; return `${visible[d[1]].name} · ${countries[d[0]].name}<br/>${d[2] ? `Quality ${(d[2] * 100).toFixed(1)}%` : 'No coverage'}`; } },
            grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
            xAxis: { type: 'category', data: countries.map((c) => c.code), ...axis(t), splitLine: { show: false } },
            yAxis: { type: 'category', data: visible.map((x) => x.name), ...axis(t), splitLine: { show: false } },
            visualMap: { min: 0.7, max: 0.97, show: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, itemWidth: 10, textStyle: { color: t === 'dark' ? '#A8B4D6' : '#425078', fontSize: 10 }, inRange: { color: ['#1B2A5C', palette.blue, palette.cyan] }, formatter: (val: unknown) => `${Math.round(Number(val) * 100)}%` },
            series: [{ type: 'heatmap', itemStyle: { borderColor: t === 'dark' ? '#080D1F' : '#F4F6FC', borderWidth: 2, borderRadius: 3 },
              data: visible.flatMap((x, yi) => countries.map((c, xi) => [xi, yi, x.coverage.includes(c.code) ? x.quality : '-'])) }],
          })} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow={isVendor ? 'Your performance' : 'Vendor profile'} title={v.name} actions={v.verified ? <Badge tone="emerald"><BadgeCheck size={11} /> Verified</Badge> : <Badge tone="warn"><ShieldAlert size={11} /> Verification pending</Badge>} />
          {!isVendor && (
            <select aria-label="Select vendor" className={cn(inputCls, 'mb-3')} value={v.id} onChange={(e) => setSel(e.target.value)}>{visible.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          )}
          <VendorProfile v={v} />
          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
            <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">B2C CPI</div><div className="num font-bold">${v.cpiB2C}</div></div>
            <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">B2B CPI</div><div className="num font-bold">${v.cpiB2B}</div></div>
            <div className="panel-solid p-2.5"><div className="text-2xs text-ink-3">HC CPI</div><div className="num font-bold">${v.cpiHC}</div></div>
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Fieldwork allocation" title="Supply flow: vendors → live projects → markets" actions={<DemoBadge />} />
          {(() => {
            const links: { source: string; target: string; value: number }[] = [];
            live.forEach((p) => {
              const vs = p.vendors.filter((id) => visible.some((x) => x.id === id));
              vs.forEach((id) => links.push({ source: vendors.find((x) => x.id === id)!.name, target: p.code, value: Math.max(1, Math.round(p.completes / Math.max(1, p.vendors.length))) }));
              if (vs.length) p.countries.forEach((c) => links.push({ source: p.code, target: countryByCode[c].name, value: Math.max(1, Math.round(p.completes / p.countries.length)) }));
            });
            const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
            if (!links.length) return <EmptyState title="No live allocations" body="Allocations appear when projects reach Sample Allocation." />;
            return (
              <EChart ariaLabel="Sankey of vendor allocations" height={360} deps={[links.length]} option={(t) => ({
                tooltip: { trigger: 'item' },
                series: [{ type: 'sankey', left: 4, right: 90, top: 6, bottom: 6, nodeGap: 8, nodeWidth: 10, emphasis: { focus: 'adjacency' }, draggable: false,
                  label: { color: t === 'dark' ? '#ECF1FF' : '#0C142E', fontSize: 10.5 }, lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
                  data: names.map((n, i) => ({ name: n, itemStyle: { color: series[i % series.length] } })), links }],
              })} />
            );
          })()}
        </Panel>
        <Panel>
          <PanelHeader eyebrow={isVendor ? 'Opportunities for you' : 'Supplier ranking'} title={isVendor ? 'Open feasibility requests' : 'Vendor leaderboard'} actions={!isVendor && <SearchInput value={q} onChange={setQ} placeholder="Find vendor" className="w-44" />} />
          {isVendor ? (
            <ul className="space-y-2">
              {opportunities.map((o) => (
                <li key={o.id} className="panel-solid flex items-center justify-between gap-3 p-3 text-[12.5px]">
                  <div><div className="font-medium">{o.type} audience · {o.countries.map((c) => countryByCode[c]?.name).join(', ')}</div><div className="text-2xs text-ink-3">n={o.sampleSize} · IR {fmtPct(o.ir, 0)} · LOI {o.loi} min · client identity withheld</div></div>
                  <Button size="sm" variant="subtle" onClick={() => s.toast('Feasibility response drafted (demo). Not sent.', 'info')}>Respond</Button>
                </li>
              ))}
              <li className="flex items-center gap-2 pt-2 text-2xs text-ink-3"><Lock size={11} /> Competing bids, client margins and other vendors’ CPIs are hidden by policy.</li>
            </ul>
          ) : (
            <div className="space-y-1">
              {[...filtered].sort((a, b) => b.quality * b.reliability - a.quality * a.reliability).map((x, i) => (
                <motion.button key={x.id} onClick={() => setSel(x.id)} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[12.5px] hover:bg-surface-2/50', x.id === v.id && 'bg-blue/10')}>
                  <span className="num w-5 text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.name}</span><span className="block text-2xs text-ink-3">{x.coverage.length} markets · {x.audiences.join(', ')}</span></span>
                  <span className="w-28"><Bar value={x.quality * x.reliability} tone={i < 3 ? 'emerald' : 'cyan'} /></span>
                  <span className="num w-12 text-right font-semibold">{(x.quality * x.reliability * 100).toFixed(0)}</span>
                </motion.button>
              ))}
              {seeAll && <div className="pt-2 text-2xs text-ink-3">Composite = quality × delivery reliability.</div>}
            </div>
          )}
        </Panel>
      </div>

      {!isVendor && (
        <Panel className="mt-6">
          <PanelHeader eyebrow="CPI vs quality" title="Price-quality positioning (B2B rate cards)" actions={<DemoBadge />} />
          <EChart ariaLabel="Scatter of CPI and quality by vendor" height={280} deps={[]} option={(t) => ({
            tooltip: { formatter: (p: unknown) => { const d = (p as { data: [number, number, number, string] }).data; return `${d[3]}<br/>B2B CPI $${d[0]} · quality ${(d[1] * 100).toFixed(1)}%<br/>${fmtCompact(d[2])} delivered`; } },
            xAxis: { type: 'value', name: 'B2B CPI ($)', nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t) }, yAxis: { type: 'value', min: 0.65, name: 'Quality', nameTextStyle: { color: '#707EA8', fontSize: 10 }, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (x: number) => `${Math.round(x * 100)}%` } },
            series: [{ type: 'scatter', data: vendors.filter((x) => x.audiences.includes('B2B')).map((x) => [x.cpiB2B, x.quality, x.delivered, x.name]), symbolSize: (d: number[]) => 10 + Math.sqrt(d[2]) / 6,
              itemStyle: { color: { type: 'radial', x: 0.5, y: 0.5, r: 0.5, colorStops: [{ offset: 0, color: palette.cyan }, { offset: 1, color: 'rgba(36,107,253,.4)' }] }, borderColor: palette.cyan, borderWidth: 1 },
              label: { show: true, position: 'top', formatter: (p: unknown) => String((p as { data: unknown[] }).data[3]).split(' ')[0], color: t === 'dark' ? '#A8B4D6' : '#425078', fontSize: 10 } }],
          })} />
        </Panel>
      )}
    </div>
  );
}

export default function MarketplacePage() { return <Suspense><MarketInner /></Suspense>; }

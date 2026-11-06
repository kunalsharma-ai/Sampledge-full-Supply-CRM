'use client';
/**
 * Screen 15 · Global Audience Distribution. Where the reachable audience is, split by panel, and
 * when it is awake. The map shows each country as a panel donut sized by audience; the wake band
 * underneath shows every market's local day against UTC, and the hour slider dims the markets that
 * are in quiet hours at that time. "Best hour" sums expected responsiveness for the chosen markets.
 * Integration: `GET /panels/analytics` (available; country × panel split), send windows from workspace settings.
 */
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Sun } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { Badge, Button, Panel, Segmented } from '@/components/ui/primitives';
import { GeoMap } from '@/components/supply/geo-map';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { inSendWindow, markets, marketByCode, totalMembers, wakeCurve, type Market } from '@/lib/supply/connected';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const screen = screenBySlug('distribution')!;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const localOf = (h: number, m: Market) => (((h + m.utcOffset) % 24) + 24) % 24;
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;

export default function Page() { return <Suspense><Distribution /></Suspense>; }

function Distribution() {
  const params = useSearchParams();
  const [panel, setPanel] = useState<'all' | PanelId>('all');
  const [measure, setMeasure] = useState<'reachable' | 'members'>('reachable');
  const [hour, setHour] = useState(15);
  const [selected, setSelected] = useState<string | null>(params.get('c'));
  const [plan, setPlan] = useState<Set<string>>(() => new Set(params.get('c') ? [params.get('c')!] : ['US', 'GB', 'DE']));

  /** Audience in a market for the chosen panel and measure. Reachable is split by panel in proportion to members. */
  const value = (m: Market, p: 'all' | PanelId = panel) => {
    const base = measure === 'members' ? totalMembers(m) : m.reachable;
    return p === 'all' ? base : Math.round(base * (m.members[p] / totalMembers(m)));
  };
  const rows = useMemo(() => [...markets].sort((a, b) => value(b) - value(a)), [panel, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((a, m) => a + value(m), 0);
  const awakeNow = rows.filter((m) => inSendWindow(hour, m));
  const awakeShare = awakeNow.reduce((a, m) => a + value(m), 0) / (total || 1);

  const planned = rows.filter((m) => plan.has(m.code));
  const curve = HOURS.map((h) => planned.reduce((a, m) => a + (inSendWindow(h, m) ? value(m) * wakeCurve(localOf(h, m)) : 0), 0));
  const best = curve.indexOf(Math.max(...curve));
  const maxCurve = Math.max(...curve, 1);
  const togglePlan = (c: string) => setPlan((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const sel = selected ? marketByCode[selected] : null;

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Global audience distribution" subtitle="Where the reachable audience is, which panel it sits in, and what time it is there. Use it to plan when to send." />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Panel" size="sm" value={panel} onChange={setPanel} options={[{ value: 'all', label: 'All panels' }, ...panelBrands.map((b) => ({ value: b.id, label: b.short }))]} />
        <Segmented label="Measure" size="sm" value={measure} onChange={setMeasure} options={[{ value: 'reachable', label: 'Reachable today' }, { value: 'members', label: 'All members' }]} />
        <span className="ml-auto text-2xs text-ink-3"><b className="num text-ink">{fmtCompact(total)}</b> {measure === 'members' ? 'members' : 'reachable'} in {rows.length} markets</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Panel className="p-4">
          <SectionTitle help="Map" eyebrow={`At ${hh(hour)} UTC`} title={`${Math.round(awakeShare * 100)}% of the audience is inside its send window`}
            actions={<Badge tone="neutral"><Sun size={11} /> 08:00–21:00 local</Badge>} />
          <div className="h-[340px]">
            <GeoMap ariaLabel="Audience by country, split by panel" selected={selected} onSelect={setSelected}
              symbols={rows.map((m) => ({
                code: m.code, name: m.name, lat: m.lat, lon: m.lon, value: value(m), dim: !inSendWindow(hour, m),
                label: `${fmtNum(value(m))} ${measure === 'members' ? 'members' : 'reachable'}, ${hh(localOf(hour, m))} local${inSendWindow(hour, m) ? '' : ', quiet hours'}`,
                segments: (panel === 'all' ? panelBrands : panelBrands.filter((b) => b.id === panel)).map((b) => ({ color: b.color, value: value(m, b.id) })),
              }))} />
          </div>
          <label className="mt-2 block text-2xs text-ink-3">Time of day (UTC) <b className="num text-ink">{hh(hour)}</b>
            <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--primary))]" />
          </label>
          <div className="mt-1 flex flex-wrap gap-3 text-2xs text-ink-3">{panelBrands.map((b) => <span key={b.id} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden />{b.short}</span>)}<span>Faded countries are in quiet hours at this time.</span></div>
        </Panel>

        <Panel className="flex flex-col p-4">
          <SectionTitle eyebrow="Send planner" title={`Best hour: ${hh(best)} UTC`} />
          <p className="mb-2 text-2xs text-ink-3">For the markets you tick, expected opens by UTC hour, counting only hours inside each market’s send window.</p>
          <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Expected opens by hour; best at ${hh(best)} UTC`}>
            {curve.map((v, h) => <span key={h} title={`${hh(h)} UTC`} className={cn('flex-1 rounded-t-sm', h === best ? 'bg-primary' : h === hour ? 'bg-cyan' : 'bg-ink-3/30')} style={{ height: `${Math.max(3, (v / maxCurve) * 100)}%` }} />)}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-3"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          <Button size="xs" variant="ghost" className="mt-1 self-start" onClick={() => setHour(best)}>Move the map to {hh(best)} UTC</Button>
          <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Markets to plan for">
            {rows.slice(0, 14).map((m) => <button key={m.code} onClick={() => togglePlan(m.code)} aria-pressed={plan.has(m.code)} className={cn('rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ring-inset', plan.has(m.code) ? 'bg-primary/12 text-ink ring-primary/40' : 'text-ink-3 ring-ink-3/25')}>{m.code}</button>)}
          </div>
          {planned.length === 0 && <p className="mt-2 text-2xs text-warn">Tick at least one market.</p>}
          {planned.length > 0 && <p className="mt-3 text-[12px] text-ink-2">Sending at {hh(best)} UTC lands at {planned.slice(0, 4).map((m) => `${hh(localOf(best, m))} in ${m.code}`).join(', ')}{planned.length > 4 ? '…' : '.'}</p>}
          <Link href="/supply/batches" className="mt-auto pt-3 text-2xs text-primary hover:underline">Schedule batches with these windows</Link>
        </Panel>
      </div>

      <Panel className="p-4">
        <SectionTitle eyebrow="Wake band" title="Each market’s day against UTC" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-y-[3px] text-2xs">
            <caption className="sr-only">Local time in each market for each UTC hour. Filled cells are inside the 08:00 to 21:00 send window.</caption>
            <thead><tr><th scope="col" className="w-28 text-left font-semibold text-ink-3">Market</th>{HOURS.map((h) => <th key={h} scope="col" className={cn('num font-normal', h === hour ? 'font-bold text-ink' : 'text-ink-3')}>{h % 3 === 0 ? String(h).padStart(2, '0') : <span className="sr-only">{h}</span>}</th>)}<th scope="col" className="w-16 text-right font-semibold text-ink-3">Audience</th></tr></thead>
            <tbody>
              {rows.slice(0, 14).map((m) => (
                <tr key={m.code} className={cn(selected === m.code && 'outline outline-1 outline-primary/40')}>
                  <th scope="row" className="text-left font-medium"><button className="inline-flex min-h-6 items-center hover:underline" onClick={() => setSelected(m.code)}>{m.name}</button></th>
                  {HOURS.map((h) => {
                    const l = localOf(h, m), on = inSendWindow(h, m);
                    return <td key={h} className="p-0" title={`${hh(l)} local`}><span className={cn('block h-6', on ? 'bg-primary' : 'bg-ink-3/10', h === hour && 'ring-1 ring-inset ring-ink')} style={{ opacity: on ? 0.25 + wakeCurve(l) * 0.75 : 1 }} /><span className="sr-only">{hh(l)}{on ? ' send window' : ' quiet'}</span></td>;
                  })}
                  <td className="num pl-2 text-right">{fmtCompact(value(m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-2xs text-ink-3">Darker cells are hours when panellists are more likely to open an invitation. The outlined column is the hour on the slider.</p>
      </Panel>

      <Panel className="p-4">
        <SectionTitle eyebrow="Panel stacks" title="Audience by country and panel" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <caption className="sr-only">Audience by country and panel</caption>
            <thead><tr className="text-left text-2xs text-ink-3"><th scope="col" className="py-1.5 font-semibold">Market</th>{panelBrands.map((b) => <th key={b.id} scope="col" className="py-1.5 text-right font-semibold">{b.short}</th>)}<th scope="col" className="py-1.5 pl-4 font-semibold">Mix</th><th scope="col" className="py-1.5 text-right font-semibold">Share of total</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const t = panelBrands.reduce((a, b) => a + value(m, b.id), 0) || 1;
                return (
                  <tr key={m.code} className={cn('border-t hairline', selected === m.code && 'bg-primary/[.06]')}>
                    <th scope="row" className="py-1.5 text-left font-medium">{m.name}</th>
                    {panelBrands.map((b) => <td key={b.id} className="num py-1.5 text-right">{fmtCompact(value(m, b.id))}</td>)}
                    <td className="py-1.5 pl-4"><span className="flex h-2 w-32 overflow-hidden rounded-full" aria-hidden>{panelBrands.map((b) => <span key={b.id} style={{ width: `${(value(m, b.id) / t) * 100}%`, background: b.color }} />)}</span></td>
                    <td className="num py-1.5 text-right text-ink-2">{((value(m) / (total || 1)) * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sel && <p className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-ink-3">Selected: <b className="text-ink">{sel.name}</b> · {hh(localOf(hour, sel))} local · {panelBrands.map((b) => <PanelChip key={b.id} panel={b.id} short />)} <Link className="text-primary hover:underline" href="/supply/global-intelligence">See requests in field</Link></p>}
      </Panel>
    </div>
  );
}

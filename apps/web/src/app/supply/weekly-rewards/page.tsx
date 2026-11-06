'use client';
/**
 * Screen 18 · Weekly Rewards Surveys. A week strip across the top (sent, live, scheduled,
 * planned), programme health below it (uptake and cost per complete per week), and a template
 * carousel to assign a template to any week that has not gone out yet.
 * Integration: programme `GET/PUT /panels/weekly-programme` (planned); costs from the ledger.
 */
import { motion } from 'motion/react';
import { CalendarHeart, Check, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useRef, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { StatusPill, type Status } from '@/components/ui/status';
import { KpiTile, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { weeklyTemplates, weeks as seed, type Week } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtMoney, fmtNum } from '@/lib/utils';

const screen = screenBySlug('weekly-rewards')!;
const pill: Record<Week['status'], Status> = { sent: 'completed', live: 'live', scheduled: 'scheduled', planned: 'draft' };

export default function WeeklyRewards() {
  const toast = useOS((s) => s.toast);
  const [list, setList] = useState(seed);
  const [selWeek, setSelWeek] = useState(seed.find((w) => w.status === 'scheduled')!.week);
  const carousel = useRef<HTMLUListElement>(null);
  const sel = list.find((w) => w.week === selWeek)!;
  const editable = sel.status === 'scheduled' || sel.status === 'planned';
  const sent = list.filter((w) => w.status === 'sent');
  const uptake = sent.map((w) => w.completes / w.invites);
  const cpc = sent.map((w) => w.cost / w.completes);
  const last = sent[sent.length - 1], prev = sent[sent.length - 2];

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Weekly rewards surveys" subtitle="A short survey every week keeps members active between client studies. Choose what goes out each week and watch what it costs." />

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10" aria-label="Programme weeks">
        {list.map((w, i) => (
          <motion.li key={w.week} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            <button onClick={() => setSelWeek(w.week)} aria-pressed={w.week === selWeek}
              className={cn('h-full w-full rounded-xl border p-2.5 text-left transition-colors', w.week === selWeek ? 'border-primary bg-primary/10' : 'hairline bg-surface/60 hover:bg-surface-2/50', w.status === 'live' && 'ring-1 ring-cyan/50')}>
              <span className="flex items-center justify-between text-2xs text-ink-3">{w.label}{w.status === 'live' && <span className="h-2 w-2 animate-pulse rounded-full bg-cyan" aria-hidden />}</span>
              <span className="mt-1 block truncate text-[12px] font-semibold">{w.template}</span>
              <span className="num mt-0.5 block text-2xs text-ink-3">{w.completes ? `${fmtNum(w.completes)} done` : w.status}</span>
            </button>
          </motion.li>
        ))}
      </ol>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiTile label="Uptake, last week" value={uptake[uptake.length - 1]} format="pct" delta={uptake[uptake.length - 1] - uptake[uptake.length - 2]} spark={uptake.map((u) => u * 100)} hint="Completes divided by invitations" />
        <KpiTile label="Cost per complete" value={last.cost / last.completes} format="money" delta={(last.cost / last.completes - prev.cost / prev.completes) / (prev.cost / prev.completes)} good="down" spark={cpc} hint="Points paid, in dollars, per completed weekly survey" />
        <KpiTile label="Members reached, 6 weeks" value={sent.reduce((a, w) => a + w.completes, 0)} format="compact" hint="Total weekly-survey completes across the last six sent weeks" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="p-4">
          <SectionTitle eyebrow="Programme health" title="Uptake and cost per complete" />
          <EChart ariaLabel="Weekly uptake and cost per complete" height={240} deps={[list.length]} option={(t) => ({
            grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true }, legend: {}, tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: sent.map((w) => w.label), ...axis(t) },
            yAxis: [{ type: 'value', ...axis(t, { axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%`, color: 'rgb(var(--ink-3))', fontSize: 10.5 } }) }, { type: 'value', ...axis(t, { splitLine: { show: false }, axisLabel: { formatter: (v: number) => `$${v.toFixed(2)}`, color: 'rgb(var(--ink-3))', fontSize: 10.5 } }) }],
            series: [
              { type: 'bar', name: 'Uptake', data: uptake, barWidth: 18, itemStyle: { color: 'rgb(var(--chart-1))', borderRadius: [4, 4, 0, 0] } },
              { type: 'line', name: 'Cost per complete', yAxisIndex: 1, data: cpc.map((c) => Number(c.toFixed(3))), symbolSize: 6, itemStyle: { color: 'rgb(var(--chart-4))' } },
            ],
          })} />
        </Panel>

        <Panel className="p-4">
          <SectionTitle help="Selected week" eyebrow={sel.label} title={sel.template} actions={<StatusPill status={pill[sel.status]} />} />
          <dl className="grid grid-cols-2 gap-2 text-center text-[12.5px]">
            {[['Invitations', fmtNum(sel.invites)], ['Completes', sel.completes ? fmtNum(sel.completes) : '—'], ['Cost', sel.cost ? fmtMoney(sel.cost, sel.cost >= 10_000) : '—'], ['Topics', sel.topics.join(', ')]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2/40 p-2"><dt className="text-2xs text-ink-3">{k}</dt><dd className="num truncate font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-3"><Clock3 size={12} /> Sends Monday 09:00 local time; closes Sunday night.</p>
          {!editable && <p className="mt-1 text-2xs text-ink-3">This week has gone out, so its template is locked.</p>}
        </Panel>
      </div>

      <Panel className="p-4">
        <SectionTitle help="Templates" eyebrow="Templates" title={editable ? `Choose a template for ${sel.label}` : 'Template library'}
          actions={<><Button size="icon-sm" variant="ghost" aria-label="Scroll templates left" onClick={() => carousel.current?.scrollBy({ left: -300, behavior: 'smooth' })}><ChevronLeft size={14} /></Button><Button size="icon-sm" variant="ghost" aria-label="Scroll templates right" onClick={() => carousel.current?.scrollBy({ left: 300, behavior: 'smooth' })}><ChevronRight size={14} /></Button></>} />
        <ul ref={carousel} className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label="Weekly survey templates">
          {weeklyTemplates.map((tp) => {
            const on = sel.template === tp.name;
            return (
              <li key={tp.id} className="w-[250px] shrink-0 snap-start">
                <div className={cn('flex h-full flex-col rounded-2xl border p-4', on ? 'border-primary bg-primary/[.06]' : 'hairline bg-surface-2/30')}>
                  <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/12 text-primary"><CalendarHeart size={15} /></span><b className="text-[13.5px]">{tp.name}</b>{on && <Badge tone="blue" className="ml-auto">Chosen</Badge>}</div>
                  <p className="mt-2 flex-1 text-[12px] text-ink-2">{tp.desc}</p>
                  <div className="mt-2 text-2xs text-ink-3">{tp.questions} questions · about {tp.loi} min</div>
                  <Button size="xs" variant={on ? 'ghost' : 'primary'} className="mt-3" disabled={!editable || on}
                    onClick={() => { setList((l) => l.map((w) => (w.week === sel.week ? { ...w, template: tp.name } : w))); toast(`${sel.label} will use ${tp.name}`, 'ok'); }}>
                    {on ? <><Check size={12} /> In use</> : 'Use this week'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}

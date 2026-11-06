'use client';
/**
 * Screen 1 · Super Admin Executive Dashboard (Audience Orbit X).
 *
 * Hierarchy, top to bottom: (1) is supply healthy? Supply Orbit + six KPIs; (2) what is in the
 * field and what needs me? Fieldwork flight deck + decision queue; (3) where is it coming from?
 * panel brand cards, hourly completes, top countries; (4) what could go wrong? quality, support,
 * activity. Everything drills down to the screen that owns it.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Boxes, Check, ChevronRight, CirclePause, CirclePlay, Pause, Rocket, ShieldAlert, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Bar, Button, Drawer, Panel, ProgressRing, Segmented, buttonVariants } from '@/components/ui/primitives';
import { Sparkline } from '@/components/ui/kpi';
import { ConfirmDialog } from '@/components/ui/overlay';
import { DataTable, type Column } from '@/components/ui/table';
import { StatusPill, paceStatus, statusMeta } from '@/components/ui/status';
import { CountryChips, KpiTile, PanelChip, ProductChip, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { SupplyOrbit } from '@/components/supply/orbit';
import { useOS } from '@/lib/store';
import { loadPanelStats, useSupplyData } from '@/lib/supply/data';
import {
  activityFeed, audienceRequests, countries, decisions as decisionSeed, funnel, hourlyCompletes, kpis, panelStats, qualitySignals, supportSla,
  type AudienceRequest, type Decision, type PanelId,
} from '@/lib/supply/demo';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtMoney, fmtNum } from '@/lib/utils';

type Range = 'today' | '7d' | '30d';
const rangeScale: Record<Range, number> = { today: 1, '7d': 6.6, '30d': 27.4 };
const rangeLabel: Record<Range, string> = { today: 'vs yesterday', '7d': 'vs previous 7 days', '30d': 'vs previous 30 days' };
const screen = screenBySlug('executive')!;

export default function ExecutiveDashboard() {
  const [range, setRange] = useState<Range>('today');
  const [panel, setPanel] = useState<'all' | PanelId>('all');
  const [open, setOpen] = useState<AudienceRequest | null>(null);
  const [requests, setRequests] = useState(audienceRequests);
  const toast = useOS((s) => s.toast);
  const panels = useSupplyData('exec:panels', () => panelStats, loadPanelStats);

  const share = panel === 'all' ? 1 : panels.data.find((p) => p.id === panel)!.active30 / panels.data.reduce((s, p) => s + p.active30, 0);
  const shownKpis = kpis.map((k) => {
    const flow = k.id === 'completes';
    const v = k.format === 'pct' ? k.value : k.value * share * (flow ? rangeScale[range] : 1);
    return { ...k, value: v, delta: k.delta * (range === 'today' ? 1 : range === '7d' ? 0.7 : 0.45) };
  });
  const shownRequests = panel === 'all' ? requests : requests.filter((r) => r.panels[panel] > 0);
  const stages = funnel.map((f) => ({ ...f, value: Math.round(f.value * share) }));

  const setStatus = (id: string, status: AudienceRequest['status']) => {
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    setOpen((o) => (o && o.id === id ? { ...o, status } : o));
  };

  return (
    <div className="space-y-5">
      <SupplyHeader screen={screen} title="Supply command" source={panels.source === 'live' ? 'mixed' : 'demo'}
        subtitle="Respondent supply across Turn2Opinion, MyFrequentRewards and MyHealthOpinions, the fieldwork it feeds, and the decisions waiting on you."
        actions={<>
          <Segmented label="Panel" size="sm" value={panel} onChange={setPanel} options={[{ value: 'all', label: 'All panels' }, { value: 't2o', label: 'T2O' }, { value: 'mfr', label: 'MFR' }, { value: 'mho', label: 'MHO' }]} />
          <Segmented label="Range" size="sm" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} />
        </>} />

      {/* 1 · Is supply healthy? */}
      <section aria-labelledby="h-health" className="grid gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-5">
          <SectionTitle id="h-health" eyebrow="Supply Orbit" title="From registered to reachable today"
            actions={<Link href="/supply/segmentation" className="inline-flex items-center gap-1 text-2xs font-semibold text-primary hover:underline"><Boxes size={12} /> Build an audience</Link>} />
          <SupplyOrbit stages={stages} size={250} />
        </Panel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-7">
          {shownKpis.map((k, i) => (
            <KpiTile key={k.id} label={k.label} value={k.value} format={k.format} delta={k.delta} good={k.good} spark={k.spark} hint={k.hint}
              period={rangeLabel[range]} color={`rgb(var(--chart-${(i % 6) + 1}))`}
              href={{ active: '/supply/panellists', reach: '/supply/feasibility', completes: '/supply/quotas', cr: '/supply/routing', liability: '/supply/rewards', tickets: '/supply/support' }[k.id]} />
          ))}
        </div>
      </section>

      {/* 2 · What is in the field, and what needs me? */}
      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="min-w-0 xl:col-span-8">
          <SectionTitle eyebrow="Fieldwork flight deck" title={`${shownRequests.filter((r) => r.status === 'live' || r.status === 'soft-launch').length} audience requests in field`}
            actions={<Link href="/supply/sampleon" className="inline-flex items-center gap-1 text-2xs font-semibold text-primary hover:underline">Open in SampAudience <ArrowRight size={12} /></Link>} />
          <FlightDeck rows={shownRequests} onOpen={setOpen} />
        </Panel>
        <Panel className="xl:col-span-4">
          <DecisionQueue onToast={toast} />
        </Panel>
      </section>

      {/* 3 · Where is it coming from? */}
      <section aria-label="Panels" className="grid gap-4 md:grid-cols-3">
        {panels.data.map((p) => (
          <Link key={p.id} href={`/supply/${{ t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' }[p.id]}`}
            className={cn('panel group relative overflow-hidden p-4 transition-shadow hover:shadow-lift', panel !== 'all' && panel !== p.id && 'opacity-55')}>
            <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: p.color }} aria-hidden />
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-[15px] font-semibold">{p.name}</div>
                <div className="text-2xs text-ink-3">{p.focus}</div>
              </div>
              <ProgressRing value={p.profileCompletion} size={46} stroke={5} color={p.color} sub="profiled" />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div><dt className="text-2xs text-ink-3">Members</dt><dd className="num font-jakarta text-[15px] font-bold">{fmtCompact(p.members)}</dd></div>
              <div><dt className="text-2xs text-ink-3">Active 30d</dt><dd className="num font-jakarta text-[15px] font-bold">{((p.active30 / p.members) * 100).toFixed(0)}%</dd></div>
              <div><dt className="text-2xs text-ink-3">Completion</dt><dd className="num font-jakarta text-[15px] font-bold">{(p.completionRate * 100).toFixed(0)}%</dd></div>
            </dl>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="text-2xs text-ink-3">Liability <b className="num text-ink-2">{fmtMoney(p.rewardLiability)}</b> · {p.openTickets} tickets</div>
              <div className="w-24"><Sparkline data={p.trend} color={p.color} height={22} /></div>
            </div>
            <ChevronRight size={14} className="absolute bottom-3 right-3 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-8">
          <SectionTitle eyebrow="Last 24 hours, UTC" title="Validated completes by hour" />
          <EChart ariaLabel="Stacked area chart of validated completes per hour for each panel" height={330} deps={[panel]}
            option={(t) => ({
              legend: {},
              grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: { type: 'category', boundaryGap: false, data: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`), ...axis(t, { splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axis(t) },
              series: hourlyCompletes.filter((s) => panel === 'all' || s.panel.toLowerCase() === panel).map((s) => ({
                name: s.panel, type: 'line', stack: 'c', smooth: 0.35, symbol: 'none', data: s.data,
                lineStyle: { width: 1.6, color: s.color }, itemStyle: { color: s.color }, areaStyle: { opacity: 0.22, color: s.color },
              })),
            })} />
        </Panel>
        <Panel className="xl:col-span-4">
          <SectionTitle eyebrow="Top 10 markets" title="Reachable today" actions={<Link href="/supply/global-intelligence" className="text-2xs font-semibold text-primary hover:underline">Globe</Link>} />
          <ol className="space-y-1.5">
            {countries.map((c, i) => (
              <li key={c.code}>
                <Link href={`/supply/global-intelligence?country=${c.code}`} className="grid grid-cols-[22px_1fr_auto] items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2/50">
                  <span className="font-mono text-[10.5px] font-semibold text-ink-3">{c.code}</span>
                  <span className="min-w-0">
                    <span className="flex justify-between text-[12.5px]"><span className="truncate">{c.name}</span><span className="num font-semibold">{fmtCompact(c.reachable * share)}</span></span>
                    <Bar value={c.reachable / countries[0].reachable} tone={i < 3 ? 'cyan' : 'blue'} className="mt-1 h-1" />
                  </span>
                  <span className={cn('num w-11 text-right text-2xs font-semibold', c.delta >= 0 ? 'text-emerald' : 'text-danger')}>{c.delta >= 0 ? '+' : ''}{(c.delta * 100).toFixed(1)}%</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </section>

      {/* 4 · What could go wrong? */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <SectionTitle eyebrow="Quality & risk" title="Signals this week" actions={<Link href="/supply/quality-risk" className="text-2xs font-semibold text-primary hover:underline">Review</Link>} />
          <ul className="grid grid-cols-2 gap-3">
            {qualitySignals.map((q) => (
              <li key={q.id} className="panel-solid p-3">
                <div className="text-2xs text-ink-3">{q.label}</div>
                <div className="num font-jakarta text-lg font-bold">{fmtNum(q.value)}</div>
                <Sparkline data={q.trend} color="rgb(var(--danger))" height={20} fill={false} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Respondent support" title="Service levels" actions={<Link href="/supply/support" className="text-2xs font-semibold text-primary hover:underline">Inbox</Link>} />
          <div className="flex items-center gap-4">
            <ProgressRing value={supportSla.withinSla} size={84} stroke={7} color="rgb(var(--emerald))" sub="within SLA" />
            <dl className="grid flex-1 grid-cols-2 gap-3">
              <div><dt className="text-2xs text-ink-3">Backlog</dt><dd className="num font-jakarta text-lg font-bold">{Math.round(supportSla.backlog * share)}</dd></div>
              <div><dt className="text-2xs text-ink-3">First reply</dt><dd className="num font-jakarta text-lg font-bold">{supportSla.firstResponseMin}m</dd></div>
              <div><dt className="text-2xs text-ink-3">CSAT</dt><dd className="num font-jakarta text-lg font-bold">{supportSla.csat}/5</dd></div>
              <div><dt className="text-2xs text-ink-3">AI drafted</dt><dd className="num font-jakarta text-lg font-bold">61%</dd></div>
            </dl>
          </div>
        </Panel>
        <Panel>
          <SectionTitle eyebrow="Activity" title="Just happened" actions={<Link href="/supply/activity" className="text-2xs font-semibold text-primary hover:underline">Timeline</Link>} />
          <ul className="space-y-2">
            {activityFeed.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-2.5 text-[12.5px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" aria-hidden />
                <span className="flex-1 text-ink-2">{a.text}</span>
                <span className="shrink-0 text-2xs text-ink-3">{a.at}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <RequestDrawer r={open} onClose={() => setOpen(null)} onStatus={(id, s) => { setStatus(id, s); toast(s === 'paused' ? `${id} paused. Invitations stopped.` : `${id} resumed.`, s === 'paused' ? 'warn' : 'ok'); }} />
    </div>
  );
}

function QuotaDots({ r }: { r: AudienceRequest }) {
  return (
    <span className="inline-flex gap-1" aria-label={r.quotas.map((q) => `${q.label} ${statusMeta(paceStatus(q.achieved, q.target, r.elapsed)).label}`).join(', ')}>
      {r.quotas.map((q) => {
        const st = paceStatus(q.achieved, q.target, r.elapsed);
        const c = { active: 'bg-emerald', pending: 'bg-warn', 'at-risk': 'bg-danger', 'quota-full': 'bg-orange', draft: 'bg-ink-3/40' }[st as 'active'] ?? 'bg-ink-3/40';
        return <span key={q.label} title={`${q.label}: ${q.achieved}/${q.target}`} className={cn('h-2.5 w-2.5 rounded-[3px]', r.status === 'scheduled' || r.status === 'pending' ? 'bg-ink-3/25' : c)} />;
      })}
    </span>
  );
}

function FlightDeck({ rows, onOpen }: { rows: AudienceRequest[]; onOpen: (r: AudienceRequest) => void }) {
  const cols: Column<AudienceRequest>[] = [
    { key: 'req', label: 'Request', sort: (r) => r.title, render: (r) => (
      <span className="flex min-w-0 flex-col py-1"><span className="max-w-[220px] truncate font-medium">{r.title}</span><span className="flex items-center gap-1.5 text-2xs text-ink-3">{r.id} · <CountryChips codes={r.countries} max={2} /></span></span>) },
    { key: 'src', label: 'Source', sort: (r) => r.source, render: (r) => <ProductChip product={r.source === 'PROJEXA' ? 'projexa' : 'zapx'}>{r.sourceRef}</ProductChip> },
    { key: 'client', label: 'Client', sort: (r) => r.client, render: (r) => r.client, optional: true },
    { key: 'prog', label: 'Completes', sort: (r) => r.completes / r.target, render: (r) => (
      <span className="flex w-28 flex-col gap-1"><span className="num text-2xs"><b className="text-ink">{fmtNum(r.completes)}</b> <span className="text-ink-3">/ {fmtNum(r.target)}</span></span><Bar value={r.completes / r.target} tone={r.completes / r.target > r.elapsed * 0.9 ? 'emerald' : 'orange'} className="h-1" /></span>) },
    { key: 'q', label: 'Quotas', render: (r) => <QuotaDots r={r} /> },
    { key: 'ir', label: 'IR', align: 'right', sort: (r) => r.ir, render: (r) => `${Math.round(r.ir * 100)}%`, optional: true },
    { key: 'loi', label: 'LOI', align: 'right', sort: (r) => r.loi, render: (r) => `${r.loi}m`, optional: true },
    { key: 'eta', label: 'ETA', render: (r) => <span className="text-2xs text-ink-2">{r.eta}</span> },
    { key: 'st', label: 'Status', sort: (r) => r.status, render: (r) => <StatusPill status={r.status} /> },
  ];
  return <DataTable caption="Audience requests in field" rows={rows} columns={cols} getId={(r) => r.id} onOpen={onOpen} prefKey="exec-flightdeck" />;
}

const kindMeta: Record<Decision['kind'], { label: string; tone: 'blue' | 'purple' | 'emerald' | 'danger' }> = {
  allocation: { label: 'Allocation', tone: 'blue' }, launch: { label: 'Launch', tone: 'purple' }, redemption: { label: 'Redemption', tone: 'emerald' }, quality: { label: 'Quality', tone: 'danger' },
};

/** Inline approvals with a 6-second undo window; destructive quality actions need typed confirmation. */
function DecisionQueue({ onToast }: { onToast: (t: string, tone?: 'ok' | 'warn' | 'info') => void }) {
  const [items, setItems] = useState(decisionSeed);
  const [done, setDone] = useState<Record<string, { verb: string; timer: ReturnType<typeof setTimeout> }>>({});
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const decide = (d: Decision, verb: 'Approved' | 'Held') => {
    const timer = setTimeout(() => { setItems((xs) => xs.filter((x) => x.id !== d.id)); setDone((m) => { const n = { ...m }; delete n[d.id]; return n; }); }, 6000);
    setDone((m) => ({ ...m, [d.id]: { verb, timer } }));
    onToast(`${verb}: ${d.title}`, verb === 'Approved' ? 'ok' : 'info');
  };
  const undo = (id: string) => { clearTimeout(done[id]?.timer); setDone((m) => { const n = { ...m }; delete n[id]; return n; }); onToast('Undone. Back in your queue.', 'info'); };
  const pending = items.filter((d) => !done[d.id]).length;
  return (
    <>
      <SectionTitle eyebrow="Needs your decision" title={pending ? `${pending} waiting` : 'All clear'} actions={<Badge tone="warn" dot>{pending}</Badge>} />
      {items.length === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald/15 text-emerald"><Check size={18} /></span>
          <div className="font-display text-sm font-semibold">Nothing waiting on you</div>
          <p className="max-w-[220px] text-2xs text-ink-3">New allocations, launches and payouts above your approval limit will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((d) => {
              const k = kindMeta[d.kind];
              const isDone = done[d.id];
              return (
                <motion.li key={d.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} transition={{ duration: 0.2 }}
                  className="panel-solid overflow-hidden p-3">
                  {isDone ? (
                    <div className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="flex items-center gap-1.5 text-ink-2"><Check size={13} className="text-emerald" /> {isDone.verb}</span>
                      <Button size="xs" variant="ghost" onClick={() => undo(d.id)}><Undo2 size={12} /> Undo</Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge tone={k.tone}>{k.label}</Badge>
                        {d.risk && <span className={cn('text-2xs font-semibold', d.risk === 'high' ? 'text-danger' : d.risk === 'medium' ? 'text-warn' : 'text-ink-3')}>{d.risk} risk</span>}
                        {d.amount !== undefined && <span className="num ml-auto text-[12.5px] font-semibold">{fmtMoney(d.amount, false)}</span>}
                      </div>
                      <div className="mt-1.5 text-[13px] font-medium leading-snug">{d.title}</div>
                      <div className="mt-0.5 text-2xs text-ink-3">{d.detail}</div>
                      <div className="mt-2 flex gap-1.5">
                        {d.kind === 'quality'
                          ? <Button size="xs" variant="danger" onClick={() => setConfirm(d)}><ShieldAlert size={12} /> Suspend…</Button>
                          : <Button size="xs" variant="success" onClick={() => decide(d, 'Approved')}><Check size={12} /> {d.kind === 'launch' ? 'Launch' : 'Approve'}</Button>}
                        <Button size="xs" variant="ghost" onClick={() => decide(d, 'Held')}><Pause size={12} /> Hold</Button>
                      </div>
                    </>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title="Suspend 18 accounts?" confirmLabel="Suspend accounts" typeToConfirm="SUSPEND 18"
        body={<>These panellists stop receiving invitations and cannot redeem rewards until a reviewer reinstates them. Pending rewards are held, not forfeited. <span className="text-ink-3">Demo: nothing is sent.</span></>}
        onConfirm={() => confirm && decide(confirm, 'Approved')} />
    </>
  );
}

function RequestDrawer({ r, onClose, onStatus }: { r: AudienceRequest | null; onClose: () => void; onStatus: (id: string, s: AudienceRequest['status']) => void }) {
  const [confirmPause, setConfirmPause] = useState(false);
  const mix = useMemo(() => (r ? (Object.entries(r.panels) as [PanelId, number][]).filter(([, v]) => v > 0) : []), [r]);
  return (
    <Drawer open={!!r} onClose={onClose} width={520} title={r?.title ?? ''} subtitle={r ? <span className="flex flex-wrap items-center gap-2">{r.id} · {r.client} <ProductChip product={r.source === 'PROJEXA' ? 'projexa' : 'zapx'}>{r.sourceRef}</ProductChip></span> : null}>
      {r && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <ProgressRing value={r.completes / r.target} size={78} stroke={7} color="rgb(var(--primary))" sub="complete" />
            <dl className="grid flex-1 grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-2xs text-ink-3">Completes</dt><dd className="num font-semibold">{fmtNum(r.completes)} / {fmtNum(r.target)}</dd></div>
              <div><dt className="text-2xs text-ink-3">IR · LOI</dt><dd className="num font-semibold">{Math.round(r.ir * 100)}% · {r.loi}m</dd></div>
              <div><dt className="text-2xs text-ink-3">ETA</dt><dd className="font-semibold">{r.eta}</dd></div>
            </dl>
          </div>
          <div>
            <div className="eyebrow mb-2">Quota cells</div>
            <ul className="space-y-2.5">
              {r.quotas.map((q) => {
                const st = paceStatus(q.achieved, q.target, r.elapsed);
                return (
                  <li key={q.label}>
                    <div className="mb-1 flex items-center justify-between text-[12.5px]"><span>Age {q.label}</span><span className="flex items-center gap-2"><span className="num text-ink-3">{q.achieved}/{q.target}</span><StatusPill status={st} /></span></div>
                    <Bar value={q.achieved / q.target} tone={st === 'at-risk' ? 'danger' : st === 'pending' ? 'orange' : 'emerald'} />
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-2">Supply mix</div>
            <div className="flex flex-wrap gap-3">{mix.map(([p, v]) => <span key={p} className="flex items-center gap-1.5"><PanelChip panel={p} /><span className="num text-2xs text-ink-3">{Math.round(v * 100)}%</span></span>)}</div>
            <div className="mt-2"><CountryChips codes={r.countries} max={8} /></div>
          </div>
          <div className="flex flex-wrap gap-2 border-t hairline pt-4">
            <Link href="/supply/sampleon" className={buttonVariants({ variant: 'primary', size: 'sm' })}><Rocket size={13} /> Open in SampAudience</Link>
            <Link href="/supply/quotas" className={buttonVariants({ size: 'sm' })}>Quota monitor</Link>
            {r.status === 'paused'
              ? <Button size="sm" variant="success" onClick={() => onStatus(r.id, 'live')}><CirclePlay size={13} /> Resume</Button>
              : (r.status === 'live' || r.status === 'soft-launch') && <Button size="sm" variant="danger" onClick={() => setConfirmPause(true)}><CirclePause size={13} /> Pause</Button>}
          </div>
          <p className="text-2xs text-ink-3">Demo data. When SampAudience is connected these figures come from its audience request API and pausing stops invitations there.</p>
          <ConfirmDialog open={confirmPause} onOpenChange={setConfirmPause} title={`Pause ${r.id}?`} confirmLabel="Pause invitations"
            body="No new invitations are sent and survey cards are hidden. Respondents already in the survey can finish. You can resume at any time."
            onConfirm={() => onStatus(r.id, 'paused')} />
        </div>
      )}
    </Drawer>
  );
}

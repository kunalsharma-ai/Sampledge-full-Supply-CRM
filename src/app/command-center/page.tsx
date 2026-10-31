'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { dailyCompletes, dailyIR, monthlyCost, monthlyForecast, monthlyRevenue, months, panels, vendors, DEMO_NOW } from '@/lib/demo/data';
import { useOS } from '@/lib/store';
import { can, roles } from '@/lib/roles';
import { avg, fmtCompact, fmtMoney, fmtNum, fmtPct, sum } from '@/lib/utils';
import { palette } from '@/lib/tokens';
import { KpiCard, type KpiProps } from '@/components/ui/kpi';
import { Badge, Button, DemoBadge, Panel, PanelHeader } from '@/components/ui/primitives';
import { GlobeExplorer } from '@/components/three/globe-explorer';
import { ParticleField } from '@/components/three/particle-field';
import { OpsFlow } from '@/components/flow/ops-flow';
import { AssistantThread } from '@/components/shell/assistant';
import { EChart, axis } from '@/components/charts/echart';

const trend = (end: number, n = 14, vol = 0.08, seed = 1) =>
  Array.from({ length: n }, (_, i) => end * (0.82 + (i / n) * 0.18 + Math.sin(i * 1.3 + seed) * vol));

export default function CommandCenter() {
  const s = useOS();
  const margins = can(s.role, 'view:margins');
  const persona = roles.find((r) => r.id === s.role)!;

  const k = useMemo(() => {
    const open = s.projects.filter((p) => !['Project Closure', 'Invoice'].includes(p.stage));
    const field = s.projects.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage));
    const elapsed = (p: (typeof field)[number]) => { const a = new Date(p.start).getTime(), b = new Date(p.deadline).getTime(); return Math.min(1, Math.max(0, (DEMO_NOW.getTime() - a) / Math.max(1, b - a))); };
    const onTrack = field.filter((p) => p.completes / p.target >= elapsed(p) - 0.1).length;
    const invoices = s.projects.filter((p) => p.stage === 'Invoice');
    const withMargin = s.projects.filter((p) => p.completes > 0);
    return {
      active: open.length,
      newReq: s.opportunities.filter((o) => o.stage === 'New RFQ').length,
      pending: s.opportunities.filter((o) => o.stage === 'Quote Sent' || o.stage === 'Negotiation').length,
      won: s.opportunities.filter((o) => o.stage === 'Won').length,
      surveys: s.surveys.filter((v) => v.status === 'Published').length,
      completes: sum(s.projects.map((p) => p.completes)),
      ir: sum(field.map((p) => p.ir * p.completes)) / Math.max(1, sum(field.map((p) => p.completes))),
      panelists: sum(panels.map((p) => p.active)),
      vendors: vendors.filter((v) => v.activeAllocations > 0).length,
      revenue: monthlyRevenue[11],
      margin: avg(withMargin.map((p) => 1 - p.cpiCost / p.cpiSell)),
      invoices: sum(invoices.map((p) => p.cpiSell * p.completes)),
      invoiceCount: invoices.length,
      quality: avg(field.map((p) => p.quality)),
      delivery: field.length ? onTrack / field.length : 0,
      fieldCount: field.length,
    };
  }, [s.projects, s.opportunities, s.surveys]);

  const kpis: KpiProps[] = [
    { label: 'Total active projects', value: k.active, format: (n) => fmtNum(n), delta: 0.083, spark: trend(k.active, 14, 0.05, 1), href: '/projects', color: 'rgb(var(--blue))' },
    { label: 'New client requests', value: k.newReq, format: (n) => fmtNum(n), delta: 0.25, spark: trend(k.newReq + 2, 14, 0.2, 2), href: '/crm', status: k.newReq > 3 ? { tone: 'warn', text: 'Awaiting qualification' } : undefined },
    { label: 'Pending bids', value: k.pending, format: (n) => fmtNum(n), delta: -0.04, deltaGoodWhen: 'down', spark: trend(k.pending, 14, 0.12, 3), href: '/crm', color: 'rgb(var(--purple))' },
    { label: 'Bids won', value: k.won, format: (n) => fmtNum(n), delta: 0.18, spark: trend(k.won, 14, 0.1, 4), href: '/crm', color: 'rgb(var(--emerald))' },
    { label: 'Active surveys', value: k.surveys, format: (n) => fmtNum(n), delta: 0.05, spark: trend(k.surveys, 14, 0.06, 5), href: '/survey-studio' },
    { label: 'Survey completes', value: k.completes, format: (n) => fmtCompact(n), delta: 0.112, spark: dailyCompletes.slice(-14), href: '/projects', color: 'rgb(var(--cyan))' },
    { label: 'Overall incidence rate', value: k.ir, format: (n) => fmtPct(n), delta: -0.021, spark: dailyIR.slice(-14), href: '/analytics', status: k.ir < 0.3 ? { tone: 'warn', text: 'Below 30% target' } : { tone: 'ok', text: 'On target' }, color: 'rgb(var(--orange))' },
    { label: 'Total active panelists', value: k.panelists, format: (n) => fmtCompact(n), delta: 0.034, spark: trend(k.panelists, 14, 0.02, 6), href: '/panels', color: 'rgb(var(--purple))' },
    { label: 'Active vendors', value: k.vendors, format: (n) => fmtNum(n), delta: 0, spark: trend(k.vendors, 14, 0.04, 7), href: '/marketplace' },
    { label: 'Monthly revenue', value: k.revenue, format: (n) => fmtMoney(n), delta: monthlyRevenue[11] / monthlyRevenue[10] - 1, period: `vs ${months[10]}`, spark: monthlyRevenue, href: '/crm', color: 'rgb(var(--emerald))' },
    { label: 'Project profitability', value: k.margin, format: (n) => fmtPct(n), delta: 0.012, spark: trend(k.margin, 14, 0.03, 8), redacted: !margins, tooltip: 'Average gross margin on fielding projects', color: 'rgb(var(--emerald))' },
    { label: 'Pending invoices', value: k.invoices, format: (n) => fmtMoney(n), status: { tone: k.invoiceCount ? 'warn' : 'ok', text: `${k.invoiceCount} projects ready to invoice` }, href: '/projects', color: 'rgb(var(--orange))' },
    { label: 'Respondent quality score', value: k.quality * 100, format: (n) => fmtNum(n, 1), delta: 0.006, spark: trend(k.quality, 14, 0.01, 9), status: { tone: 'ok', text: 'Fraud & speeder checks passing' }, href: '/analytics', color: 'rgb(var(--cyan))' },
    { label: 'Fieldwork delivery', value: k.delivery, format: (n) => fmtPct(n, 0), delta: -0.05, spark: trend(k.delivery, 14, 0.07, 10), status: { tone: k.delivery > 0.8 ? 'ok' : 'risk', text: `${k.fieldCount} projects in field` }, href: '/projects', color: 'rgb(var(--magenta))' },
  ];

  return (
    <div className="space-y-6">
      {/* A — Executive welcome */}
      <section className="panel relative overflow-hidden p-0">
        <ParticleField className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-purple/30 blur-[90px]" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-60 w-60 rounded-full bg-cyan/20 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-6 py-8 md:px-10 md:py-10">
          <div className="max-w-2xl">
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="eyebrow mb-3 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald shadow-[0_0_10px_rgb(var(--emerald))]" /> {persona.persona} · {persona.label} view <DemoBadge />
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.6 }} className="font-display text-[34px] font-bold leading-[1.05] tracking-tight md:text-[46px]">
              Welcome to <span className="text-gradient">Sampledge AI Research OS</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6 }} className="mt-3 text-[15px] text-ink-2 md:text-base">
              Your entire research ecosystem. One intelligent command center.
            </motion.p>
          </div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => s.setAssistant(true)}><Sparkles size={15} /> Ask Sampledge AI</Button>
            <Link href="/crm?new=1"><Button>New RFQ <ArrowRight size={14} /></Button></Link>
          </motion.div>
        </div>
      </section>

      {/* B — Live business metrics */}
      <section aria-label="Business metrics">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow">Business metrics · trailing 30 days</h2>
          <span className="text-2xs text-ink-3">Comparisons use simulated prior-period values</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {kpis.map((p, i) => <KpiCard key={p.label} {...p} index={i} />)}
        </div>
      </section>

      {/* C + E — Globe and AI assistant */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel className="p-5">
          <PanelHeader eyebrow="Global research activity" title="Markets, fieldwork and supply in motion" actions={<Badge tone="cyan">{s.projects.filter((p) => ['Soft Launch', 'Full Launch', 'Fieldwork Monitoring'].includes(p.stage)).length} projects in field</Badge>} />
          <GlobeExplorer height={540} />
        </Panel>
        <Panel className="flex flex-col p-5">
          <PanelHeader eyebrow="AI executive assistant" title="Ask about your operations" actions={<DemoBadge label="Rule-based" />} />
          <div className="min-h-[420px] flex-1"><AssistantThread /></div>
        </Panel>
      </div>

      {/* D — Research operations flow */}
      <Panel>
        <PanelHeader eyebrow="Research operations flow" title="Client request to invoice, live" actions={<span className="text-2xs text-ink-3">Select a stage to inspect projects, owners and blockers</span>} />
        <OpsFlow />
      </Panel>

      {/* Revenue + fieldwork */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Finance" title="Revenue, cost and forecast" actions={<DemoBadge />} />
          <EChart ariaLabel="Monthly revenue, cost and forecast" height={260} option={(t) => ({
            tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMoney(Number(v)) },
            legend: { right: 0 },
            xAxis: { type: 'category', data: months, boundaryGap: false, ...axis(t), splitLine: { show: false } },
            yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtMoney(v) } },
            series: [
              { name: 'Revenue', type: 'line', smooth: true, data: monthlyRevenue, symbol: 'none', lineStyle: { width: 2.5, color: palette.cyan }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(24,215,242,.35)' }, { offset: 1, color: 'rgba(24,215,242,0)' }] } } },
              ...(margins ? [{ name: 'Cost', type: 'line' as const, smooth: true, data: monthlyCost, symbol: 'none', lineStyle: { width: 1.5, color: palette.purple } }] : []),
              { name: 'Forecast', type: 'line', smooth: true, data: monthlyForecast, symbol: 'circle', symbolSize: 5, lineStyle: { width: 1.5, type: 'dashed', color: palette.orange }, itemStyle: { color: palette.orange } },
            ],
          })} deps={[margins]} />
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Fieldwork" title="Daily completes and incidence" actions={<DemoBadge />} />
          <EChart ariaLabel="Daily completes and incidence rate, last 30 days" height={260} option={(t) => ({
            tooltip: { trigger: 'axis' },
            legend: { right: 0 },
            xAxis: { type: 'category', data: dailyCompletes.map((_, i) => `D-${29 - i}`), ...axis(t), splitLine: { show: false } },
            yAxis: [{ type: 'value', ...axis(t) }, { type: 'value', ...axis(t), splitLine: { show: false }, axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } }],
            series: [
              { name: 'Completes', type: 'bar', data: dailyCompletes, barWidth: '55%', itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: palette.blue }, { offset: 1, color: 'rgba(113,59,255,.35)' }] } } },
              { name: 'Incidence', type: 'line', yAxisIndex: 1, data: dailyIR, smooth: true, symbol: 'none', lineStyle: { color: palette.orange, width: 2 } },
            ],
          })} />
        </Panel>
      </div>
    </div>
  );
}

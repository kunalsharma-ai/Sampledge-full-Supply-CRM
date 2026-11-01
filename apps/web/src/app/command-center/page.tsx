'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { can, roles } from '@/lib/core';
import { fmtCompact, fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { palette } from '@/lib/tokens';
import { KpiCard, type KpiProps } from '@/components/ui/kpi';
import { Badge, Button, DemoBadge, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { GlobeExplorer } from '@/components/three/globe-explorer';
import { ParticleField } from '@/components/three/particle-field';
import { OpsFlow } from '@/components/flow/ops-flow';
import { AssistantThread } from '@/components/shell/assistant';
import { EChart, axis } from '@/components/charts/echart';

type Kpi = { value: number; spark: number[]; delta: number | null; comparedWith: string | null };
type Overview = {
  asOf: string;
  kpis: Record<string, Kpi>;
  pendingInvoiceCount: number;
  fieldCount: number;
  revenue: { currency: string; months: { month: string; revenue: number; cost?: number }[]; forecast: { month: string; draftInvoices: number; weightedPipeline: number }[]; weightedPipeline: number };
  fieldwork: { day: string; completes: number; screenouts: number; incidence: number | null }[];
};

const monthLabel = (m: string) => `${new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '${m.slice(2, 4)}`;

/**
 * Executive overview. Every figure comes from GET /insights/overview: counted from the workspace's
 * records, with trends and comparisons from the daily metric history (none shown until recorded).
 */
export default function CommandCenter() {
  const s = useOS();
  const margins = can(s.role, 'view:margins');
  const persona = roles.find((r) => r.id === s.role)!;
  const { data: o, error } = useLive<Overview>('/insights/overview', [s.projects, s.opportunities, s.surveys]);

  const kpis: KpiProps[] = useMemo(() => {
    if (!o) return [];
    const k = (key: string, p: Omit<KpiProps, 'value' | 'spark' | 'delta' | 'period'>): KpiProps | null => {
      const x = o.kpis[key];
      if (!x) return null; // removed by the server for this role
      return { ...p, value: x.value, spark: x.spark.length >= 2 ? x.spark : undefined, delta: x.delta ?? undefined, period: x.comparedWith ? `vs ${new Date(x.comparedWith).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : undefined };
    };
    return [
      k('active_projects', { label: 'Total active projects', format: (n) => fmtNum(n), href: '/projects', color: 'rgb(var(--blue))' }),
      k('new_requests', { label: 'New client requests', format: (n) => fmtNum(n), href: '/crm', status: o.kpis.new_requests?.value > 3 ? { tone: 'warn', text: 'Awaiting qualification' } : undefined }),
      k('pending_bids', { label: 'Pending bids', format: (n) => fmtNum(n), deltaGoodWhen: 'down', href: '/crm', color: 'rgb(var(--purple))' }),
      k('bids_won', { label: 'Bids won', format: (n) => fmtNum(n), href: '/crm', color: 'rgb(var(--emerald))' }),
      k('active_surveys', { label: 'Active surveys', format: (n) => fmtNum(n), href: '/survey-studio' }),
      k('completes', { label: 'Survey completes', format: (n) => fmtCompact(n), href: '/projects', color: 'rgb(var(--cyan))', tooltip: 'Completes recorded across all projects' }),
      k('incidence', { label: 'Overall incidence rate', format: (n) => fmtPct(n), href: '/analytics', status: o.kpis.incidence?.value < 0.3 ? { tone: 'warn', text: 'Below 30% target' } : { tone: 'ok', text: 'On target' }, color: 'rgb(var(--orange))', tooltip: 'Completes-weighted incidence of projects in field' }),
      k('active_panelists', { label: 'Total active panelists', format: (n) => fmtCompact(n), href: '/panels', color: 'rgb(var(--purple))', tooltip: 'Panelist records with status active' }),
      k('active_vendors', { label: 'Active vendors', format: (n) => fmtNum(n), href: '/marketplace', tooltip: 'Vendors with an approved or live allocation' }),
      k('monthly_revenue', { label: 'Revenue this month', format: (n) => fmtMoney(n), href: '/finance', color: 'rgb(var(--emerald))', tooltip: `Invoices issued this calendar month, in ${o.revenue.currency}` }),
      margins ? k('margin', { label: 'Project profitability', format: (n) => fmtPct(n), tooltip: 'Average gross margin on projects with completes', color: 'rgb(var(--emerald))' }) : { label: 'Project profitability', value: 0, format: () => '', redacted: true },
      k('pending_invoices', { label: 'Pending invoices', format: (n) => fmtMoney(n), deltaGoodWhen: 'down', status: { tone: o.pendingInvoiceCount ? 'warn' : 'ok', text: `${o.pendingInvoiceCount} draft or unpaid invoice${o.pendingInvoiceCount === 1 ? '' : 's'}` }, href: '/finance', color: 'rgb(var(--orange))' }),
      k('quality', { label: 'Respondent quality score', format: (n) => fmtNum(n * 100, 1), href: '/analytics', color: 'rgb(var(--cyan))', tooltip: 'Average quality of projects in field' }),
      k('delivery', { label: 'Fieldwork delivery', format: (n) => fmtPct(n, 0), status: { tone: o.kpis.delivery?.value > 0.8 ? 'ok' : 'risk', text: `${o.fieldCount} projects in field` }, href: '/projects', color: 'rgb(var(--magenta))', tooltip: 'Share of projects in field whose completes keep pace with elapsed field time' }),
    ].filter((x): x is KpiProps => !!x);
  }, [o, margins]);

  const rev = o?.revenue;
  const hasRevenue = !!rev && (rev.months.some((m) => m.revenue || m.cost) || rev.weightedPipeline > 0);
  const fw = o?.fieldwork ?? [];
  const hasFieldwork = fw.some((d) => d.completes || d.screenouts);

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
              <span className="h-1.5 w-1.5 rounded-full bg-emerald shadow-[0_0_10px_rgb(var(--emerald))]" /> {persona.persona} · {persona.label} view
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
          <h2 className="eyebrow">Business metrics</h2>
          <span className="text-2xs text-ink-3">{o ? `From workspace records as of ${new Date(o.asOf).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. Trends build up from the daily metric history.` : ''}</span>
        </div>
        {error ? <EmptyState title="Metrics unavailable" body={error} /> : !o ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="h-[120px]" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {kpis.map((p, i) => <KpiCard key={p.label} {...p} index={i} />)}
          </div>
        )}
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
          <PanelHeader eyebrow="Finance" title={margins ? 'Invoiced revenue, purchase cost and forecast' : 'Invoiced revenue and forecast'} actions={rev && <span className="text-2xs text-ink-3">{rev.currency}</span>} />
          {!o ? <Skeleton className="h-[260px]" /> : !hasRevenue ? <EmptyState title="No invoices or pipeline yet" body="Issued invoices, purchase orders and open opportunities appear here as they are recorded." /> : (
            <EChart ariaLabel="Monthly invoiced revenue, purchase cost and forecast" height={260} option={(t) => {
              const labels = [...rev!.months.map((m) => monthLabel(m.month)), ...rev!.forecast.map((f) => monthLabel(f.month))];
              const pad = (xs: (number | null)[], before: number, after: number) => [...Array(before).fill(null), ...xs, ...Array(after).fill(null)];
              return {
                tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : fmtMoney(Number(v))) },
                legend: { right: 0 },
                xAxis: { type: 'category', data: labels, ...axis(t), splitLine: { show: false } },
                yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtMoney(v) } },
                series: [
                  { name: 'Invoiced', type: 'bar', barWidth: 12, stack: 'rev', data: pad(rev!.months.map((m) => m.revenue), 0, 3), itemStyle: { borderRadius: [4, 4, 0, 0], color: palette.cyan } },
                  { name: 'Draft invoices', type: 'bar', barWidth: 12, stack: 'rev', data: pad(rev!.forecast.map((f) => f.draftInvoices || null), 12, 0), itemStyle: { color: 'rgba(24,215,242,.55)' } },
                  { name: 'Weighted pipeline', type: 'bar', barWidth: 12, stack: 'rev', data: pad(rev!.forecast.map((f) => f.weightedPipeline || null), 12, 0), itemStyle: { borderRadius: [4, 4, 0, 0], color: 'rgba(255,159,67,.6)' } },
                  ...(margins ? [{ name: 'Purchase cost', type: 'line' as const, data: pad(rev!.months.map((m) => m.cost ?? 0), 0, 3), symbol: 'circle', symbolSize: 4, lineStyle: { width: 1.5, color: palette.purple }, itemStyle: { color: palette.purple } }] : []),
                ],
              };
            }} deps={[o, margins]} />
          )}
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Fieldwork" title="Daily completes and incidence (last 30 days)" />
          {!o ? <Skeleton className="h-[260px]" /> : !hasFieldwork ? <EmptyState title="No interviews in the last 30 days" body="Completes and screenouts from live survey links are counted here per day." /> : (
            <EChart ariaLabel="Daily completes and incidence rate, last 30 days" height={260} option={(t) => ({
              tooltip: { trigger: 'axis' },
              legend: { right: 0 },
              xAxis: { type: 'category', data: fw.map((d) => new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })), ...axis(t), splitLine: { show: false } },
              yAxis: [{ type: 'value', ...axis(t) }, { type: 'value', min: 0, max: 1, ...axis(t), splitLine: { show: false }, axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } }],
              series: [
                { name: 'Completes', type: 'bar', data: fw.map((d) => d.completes), barWidth: '55%', itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: palette.blue }, { offset: 1, color: 'rgba(113,59,255,.35)' }] } } },
                { name: 'Incidence', type: 'line', yAxisIndex: 1, data: fw.map((d) => d.incidence), connectNulls: true, smooth: true, symbol: 'none', lineStyle: { color: palette.orange, width: 2 } },
              ],
            })} deps={[o]} />
          )}
        </Panel>
      </div>
    </div>
  );
}

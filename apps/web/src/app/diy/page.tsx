'use client';
/**
 * DIY Research: a client configures a study (audience, markets, sample, incidence, length), sees an
 * indicative price range from rate cards, and submits it. Submission creates a CRM opportunity for
 * Business Development; nothing is fielded or purchased until the team quotes and the usual approvals run.
 */
import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { access, countries, type Audience } from '@/lib/core';
import { api } from '@/lib/api';
import { act, shortDate, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { Badge, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { DataTable, LiveOnly, Loadable } from '@/components/ui/data';

type Estimate = { markets: ({ country: string; n: number; covered: false } | { country: string; n: number; covered: true; cpiLow: number; cpiHigh: number; capacityOk: boolean })[]; totalLow: number; totalHigh: number; basis: string; disclaimer: string };
type Req = { id: string; title: string; audience: string; countries: string[]; sampleSize: number; incidence: number; loi: number; status: string; createdAt: string; quote: { total: number; cpi: number } | null };
const cname = (c: string) => countries.find((x) => x.code === c)?.name ?? c;

function Inner() {
  const role = useOS((s) => s.role);
  const canSubmit = role === 'client' && access(role, 'diy') === 'full';
  const [audience, setAudience] = useState<Audience>('B2C');
  const [markets, setMarkets] = useState<string[]>(['US', 'GB']);
  const [n, setN] = useState(600);
  const [ir, setIr] = useState(0.4);
  const [loi, setLoi] = useState(12);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [tick, setTick] = useState(0);
  const [qs, setQs] = useState('');
  // Debounce the estimate so typing a sample size does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQs(markets.length ? `audience=${audience}&countries=${markets.join(',')}&sampleSize=${n}&incidence=${ir}&loi=${loi}` : ''), 300);
    return () => clearTimeout(t);
  }, [audience, markets, n, ir, loi]);
  const est = useLive<Estimate>(qs ? `/diy/estimate?${qs}` : null, [qs]);
  const reqs = useLive<Req[]>('/diy/requests', [tick]);
  const toggle = (c: string) => setMarkets((m) => (m.includes(c) ? m.filter((x) => x !== c) : m.length < 10 ? [...m, c] : m));
  const valid = title.trim().length >= 3 && objective.trim().length >= 10 && markets.length > 0 && n >= 50;
  const submit = () => act(() => api('/diy/requests', { method: 'POST', body: { audience, countries: markets, sampleSize: n, incidence: ir, loi, title, objective } }), 'Request sent. The research team will review feasibility and come back with a quote.').then((r) => { if (r) { setTitle(''); setObjective(''); setTick((t) => t + 1); } });

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader eyebrow="Configure" title="Your study" />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Study name"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Snack brand tracker" aria-label="Study name" disabled={!canSubmit} /></Field>
            <Field label="Audience"><select className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value as Audience)} aria-label="Audience">{(['B2C', 'B2B', 'Healthcare'] as const).map((a) => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Completes (total)"><input type="number" min={50} max={20000} className={inputCls} value={n} onChange={(e) => setN(Math.max(0, Math.min(20000, Number(e.target.value) || 0)))} aria-label="Completes" /></Field>
            <Field label="Interview length (minutes)"><input type="number" min={3} max={60} className={inputCls} value={loi} onChange={(e) => setLoi(Math.max(3, Math.min(60, Number(e.target.value) || 3)))} aria-label="Interview length" /></Field>
          </div>
          <div className="mt-3"><Field label={`Expected incidence · ${fmtPct(ir, 0)}`} hint="Share of people contacted who qualify. If unsure, leave it; the team will check."><input type="range" min={0.02} max={1} step={0.01} value={ir} onChange={(e) => setIr(+e.target.value)} className="w-full accent-cyan" aria-label="Incidence" /></Field></div>
          <div className="mt-3"><div className="eyebrow mb-1.5">Markets ({markets.length})</div>
            <div className="flex flex-wrap gap-1.5">{countries.map((c) => <button key={c.code} type="button" onClick={() => toggle(c.code)} aria-pressed={markets.includes(c.code)} className={cn('rounded-full border px-2.5 py-1 text-[11.5px]', markets.includes(c.code) ? 'border-cyan/60 bg-cyan/15 text-cyan' : 'hairline text-ink-2 hover:bg-surface-2/60')}>{c.name}</button>)}</div>
          </div>
          <div className="mt-3"><Field label="What do you want to learn?"><textarea rows={3} className={cn(inputCls, 'h-auto py-2')} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Business question, who decides on the results, timing" aria-label="Objective" disabled={!canSubmit} /></Field></div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canSubmit ? <Button variant="primary" disabled={!valid} onClick={submit}><Send size={14} /> Send request</Button> : <Badge>Only client users submit DIY requests. You can view the configurator and incoming requests.</Badge>}
            <span className="text-2xs text-ink-3">Sending creates a request for the research team. Nothing is fielded or charged until you accept a quote.</span>
          </div>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Indicative price" title="Estimate" />
          {!markets.length ? <EmptyState title="Pick at least one market" /> : (
            <Loadable q={est}>{(e) => (
              <div className="space-y-3">
                <div className="text-center"><div className="num font-display text-3xl font-semibold">{e.totalLow ? `${fmtMoney(e.totalLow, false)} – ${fmtMoney(e.totalHigh, false)}` : 'Not available'}</div><div className="text-2xs text-ink-3">total, excluding any programming or reporting extras</div></div>
                <div className="space-y-1.5">{e.markets.map((m) => (
                  <div key={m.country} className="panel-solid flex items-center gap-2 px-3 py-2 text-[12.5px]">
                    <span className="flex-1">{cname(m.country)} <span className="text-ink-3">· n={fmtNum(m.n)}</span></span>
                    {m.covered ? <><span className="num">${m.cpiLow.toFixed(2)}–${m.cpiHigh.toFixed(2)} per complete</span>{!m.capacityOk && <Badge tone="orange">Capacity tight</Badge>}</> : <Badge tone="danger">No coverage</Badge>}
                  </div>
                ))}</div>
                <p className="rounded-lg bg-orange/10 px-3 py-2 text-2xs text-orange">{e.disclaimer}</p>
              </div>
            )}</Loadable>
          )}
        </Panel>
      </div>
      <Panel>
        <PanelHeader eyebrow="Requests" title={role === 'client' ? 'Your DIY requests' : 'DIY requests from clients'} />
        <Loadable q={reqs}>{(rows) => (
          <DataTable rows={rows} empty={<EmptyState title="No requests yet" />} cols={[
            { key: 't', label: 'Study', render: (r) => <span className="font-medium">{r.title}</span> },
            { key: 'a', label: 'Audience', render: (r) => r.audience },
            { key: 'm', label: 'Markets', render: (r) => r.countries.join(', ') },
            { key: 'n', label: 'Completes', align: 'right', render: (r) => fmtNum(r.sampleSize) },
            { key: 's', label: 'Status', render: (r) => <Badge tone={r.status === 'Received' ? 'blue' : r.status === 'Closed' ? 'neutral' : 'cyan'}>{r.status}</Badge> },
            { key: 'q', label: 'Quote', align: 'right', render: (r) => (r.quote ? fmtMoney(r.quote.total, false) : '—') },
            { key: 'd', label: 'Sent', render: (r) => shortDate(r.createdAt) },
          ]} />
        )}</Loadable>
      </Panel>
    </div>
  );
}

export default function DiyPage() {
  return (
    <div>
      <PageHeader eyebrow="DIY Research" title="Configure a study" subtitle="Set the audience, markets and sample. You get an indicative range straight away; the research team confirms feasibility with suppliers and sends a quote." actions={<Badge tone="orange">Indicative pricing · not a quote</Badge>} />
      <LiveOnly what="DIY research requests"><Inner /></LiveOnly>
    </div>
  );
}

'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { Calculator, FilePlus2, Mail, Sparkles } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { clients, countries, crmStages, months, monthlyRevenue, type CrmStage, type Opportunity } from '@/lib/demo/data';
import { allocate, rankVendors, type Audience } from '@/lib/pricing';
import { access, can } from '@/lib/roles';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { cn, fmtMoney, fmtNum, fmtPct, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, DemoBadge, Drawer, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader, SearchInput, Segmented } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';

const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
const stageTone: Record<CrmStage, 'blue' | 'cyan' | 'purple' | 'orange' | 'magenta' | 'emerald' | 'danger'> = { 'New RFQ': 'blue', Qualifying: 'cyan', Feasibility: 'purple', 'Quote Sent': 'orange', Negotiation: 'magenta', Won: 'emerald', Lost: 'danger' };

/** RFQ text → structured requirements (regex extraction; Phase 5 swaps in the AI gateway). */
function extract(text: string) {
  const t = text.toLowerCase();
  const n = Number((t.match(/(\d[\d,]*)\s*(?:completes|respondents|interviews|n\b)/) ?? [])[1]?.replace(/,/g, '')) || undefined;
  const ir = Number((t.match(/(\d{1,2})\s*%\s*(?:ir|incidence)/) ?? t.match(/(?:ir|incidence)[^\d]{0,12}(\d{1,2})\s*%/) ?? [])[1]) / 100 || undefined;
  const loi = Number((t.match(/(\d{1,2})\s*(?:-| )?(?:min|minute)/) ?? [])[1]) || undefined;
  const country = countries.find((c) => t.includes(c.name.toLowerCase()) || new RegExp(`\\b${c.code.toLowerCase()}\\b`).test(t))?.code;
  const audience: Audience | undefined = /hcp|physician|doctor|patient|oncolog|nurse|health/.test(t) ? 'Healthcare' : /b2b|decision.?maker|itdm|cio|it |manager|executive|smb|sme/.test(t) ? 'B2B' : /consumer|gen pop|shopper|b2c|adults/.test(t) ? 'B2C' : undefined;
  return { n, ir, loi, country, audience };
}

function BidAssistant({ onCreate }: { onCreate: (o: Omit<Opportunity, 'id' | 'stage' | 'probability' | 'created' | 'lastTouch' | 'demo'>) => void }) {
  const role = useOS((s) => s.role);
  const margins = can(role, 'view:margins');
  const [audience, setAudience] = useState<Audience>('B2B');
  const [country, setCountry] = useState('DE');
  const [n, setN] = useState(500);
  const [ir, setIr] = useState(0.25);
  const [loi, setLoi] = useState(15);
  const [rfqText, setRfqText] = useState('Hi team, can you quote 500 B2B IT decision-makers in Germany, 15 minute survey, approx 25% incidence? Need field in two weeks.');
  const [extracted, setExtracted] = useState<ReturnType<typeof extract> | null>(null);
  const q = { audience, country, n, ir, loi };
  const ranked = useMemo(() => rankVendors(q), [audience, country, n, ir, loi]); // eslint-disable-line react-hooks/exhaustive-deps
  const alloc = useMemo(() => allocate(q, ranked), [ranked]); // eslint-disable-line react-hooks/exhaustive-deps
  const cost = alloc.blendedCpi * (n - alloc.shortfall);
  const prices = [1.3, 1.45, 1.6].map((mk) => ({ mk, cpi: alloc.blendedCpi * mk, revenue: alloc.blendedCpi * mk * n, margin: 1 - 1 / mk }));

  const runExtract = () => {
    const e = extract(rfqText);
    setExtracted(e);
    if (e.n) setN(e.n); if (e.ir) setIr(e.ir); if (e.loi) setLoi(e.loi); if (e.country) setCountry(e.country); if (e.audience) setAudience(e.audience);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="panel-solid p-4">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold"><Mail size={14} className="text-cyan" /> Email-to-RFQ</div>
          <textarea value={rfqText} onChange={(e) => setRfqText(e.target.value)} rows={4} className={cn(inputCls, 'h-auto py-2 leading-relaxed')} aria-label="RFQ email text" />
          <Button size="sm" variant="subtle" className="mt-2 w-full" onClick={runExtract}><Sparkles size={13} /> Extract requirements</Button>
          {extracted && (
            <div className="mt-2 flex flex-wrap gap-1 text-2xs">
              {Object.entries(extracted).map(([k, v]) => <Badge key={k} tone={v === undefined ? 'danger' : 'emerald'}>{k}: {v === undefined ? 'not found' : k === 'ir' ? fmtPct(v as number, 0) : String(v)}</Badge>)}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Audience"><select className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>{['B2C', 'B2B', 'Healthcare'].map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Country"><select className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
          <Field label="Completes"><input type="number" min={10} className={inputCls} value={n} onChange={(e) => setN(Math.max(10, +e.target.value))} /></Field>
          <Field label="LOI (minutes)"><input type="number" min={3} max={60} className={inputCls} value={loi} onChange={(e) => setLoi(+e.target.value)} /></Field>
        </div>
        <Field label={`Incidence rate · ${fmtPct(ir, 0)}`}><input type="range" min={0.02} max={0.9} step={0.01} value={ir} onChange={(e) => setIr(+e.target.value)} className="w-full accent-cyan" /></Field>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
          <Badge tone="orange">Rate-card estimate · not a supplier confirmation</Badge>
          {ranked.length} eligible vendors for {audience} in {countries.find((c) => c.code === country)?.name}
        </div>
        {!ranked.length ? <EmptyState title="No vendor covers this audience and market" body="Try another country or audience, or send an open feasibility request (Phase 4)." /> : (
          <>
            <EChart ariaLabel="Estimated CPI by vendor" height={200} deps={[ranked]} option={(t) => ({
              tooltip: { trigger: 'axis', valueFormatter: (v) => `$${Number(v).toFixed(2)}` },
              grid: { left: 8, right: 16, top: 10, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: '${value}' } },
              yAxis: { type: 'category', inverse: true, data: ranked.map((r) => r.vendor.name), ...axis(t), splitLine: { show: false } },
              series: [{ type: 'bar', name: 'Est. CPI', barWidth: 12, data: ranked.map((r, i) => ({ value: r.cpi, itemStyle: { borderRadius: 6, color: i < alloc.lines.length ? palette.cyan : 'rgba(112,126,168,.45)' } })), label: { show: true, position: 'right', color: t === 'dark' ? '#A8B4D6' : '#425078', fontSize: 10, formatter: (p: unknown) => `$${Number((p as { value: number }).value).toFixed(2)}` } }],
            })} />
            <div className="grid gap-3 md:grid-cols-3">
              {prices.map((p, i) => (
                <motion.div key={p.mk} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className={cn('panel-solid p-4', i === 1 && 'ring-1 ring-inset ring-cyan/40')}>
                  <div className="flex items-center justify-between"><span className="eyebrow">Option {String.fromCharCode(65 + i)}</span>{i === 1 && <Badge tone="cyan">Suggested</Badge>}</div>
                  <div className="num mt-1 font-jakarta text-2xl font-bold">${p.cpi.toFixed(2)}<span className="text-xs font-medium text-ink-3"> CPI</span></div>
                  <div className="num text-[12px] text-ink-2">{fmtMoney(p.revenue, false)} total</div>
                  {margins ? <div className="num mt-1 text-[12px] font-semibold text-emerald">Gross margin {fmtPct(p.margin)} · {fmtMoney(p.revenue - cost, false)}</div> : <div className="mt-1 text-2xs text-ink-3">Margin hidden for your role</div>}
                  <Button size="sm" className="mt-3 w-full" onClick={() => onCreate({ title: `${audience} study · ${countries.find((c) => c.code === country)?.name} (n=${n})`, clientId: 'cl-07', owner: 'Lena Ortiz', value: Math.round(p.revenue), margin: +p.margin.toFixed(3), type: audience, countries: [country], sampleSize: n, ir, loi })}>
                    <FilePlus2 size={13} /> Create draft quote
                  </Button>
                </motion.div>
              ))}
            </div>
            <div className="panel-solid p-4 text-[12.5px]">
              <div className="mb-2 font-semibold">Suggested sample plan</div>
              {alloc.lines.map((l) => <div key={l.vendor.id} className="num flex justify-between border-b hairline py-1 last:border-0"><span>{l.vendor.name}</span><span>{l.completes} × ${l.cpi.toFixed(2)}{margins ? ` = ${fmtMoney(l.completes * l.cpi, false)}` : ''}</span></div>)}
              {alloc.shortfall > 0 && <div className="mt-2 text-orange">Shortfall of {alloc.shortfall} completes against estimated capacity. Request feasibility or extend field time.</div>}
              <div className="mt-2 text-2xs text-ink-3">Binding quotations require approval (CRM and Bidding Agent policy). Draft quotes are created in New RFQ.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NewRfqDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useOS((s) => s.createRfq);
  const [f, setF] = useState({ title: '', clientId: 'cl-01', type: 'B2C' as Audience, country: 'US', n: 1000, ir: 0.5, loi: 12, value: 8000 });
  const valid = f.title.trim().length > 2 && f.n > 0;
  return (
    <Drawer open={open} onClose={onClose} title="New RFQ" subtitle="Creates an opportunity in New RFQ. Visible to Projects and Finance once won.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!valid) return; create({ title: f.title, clientId: f.clientId, owner: 'Lena Ortiz', value: f.value, margin: 0.4, type: f.type, countries: [f.country], sampleSize: f.n, ir: f.ir, loi: f.loi }); onClose(); }}>
        <Field label="Study title"><input required className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Q1 Brand Lift Wave" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client"><select className={inputCls} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Audience"><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Audience })}>{['B2C', 'B2B', 'Healthcare'].map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Country"><select className={inputCls} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
          <Field label="Sample size"><input type="number" className={inputCls} value={f.n} onChange={(e) => setF({ ...f, n: +e.target.value })} /></Field>
          <Field label="Incidence (0–1)"><input type="number" step={0.01} min={0.01} max={1} className={inputCls} value={f.ir} onChange={(e) => setF({ ...f, ir: +e.target.value })} /></Field>
          <Field label="LOI (min)"><input type="number" className={inputCls} value={f.loi} onChange={(e) => setF({ ...f, loi: +e.target.value })} /></Field>
        </div>
        <Field label="Estimated value (USD)"><input type="number" className={inputCls} value={f.value} onChange={(e) => setF({ ...f, value: +e.target.value })} /></Field>
        <Button variant="primary" type="submit" disabled={!valid} className="w-full">Create RFQ</Button>
      </form>
    </Drawer>
  );
}

function CrmInner() {
  const s = useOS();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<'pipeline' | 'assistant'>('pipeline');
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const canEdit = access(s.role, 'crm') === 'full';
  const margins = can(s.role, 'view:margins');
  const opps = s.opportunities.filter((o) => (o.title + clientName(o.clientId) + o.owner).toLowerCase().includes(q.toLowerCase()));
  const open = opps.filter((o) => !['Won', 'Lost'].includes(o.stage));
  const won = s.opportunities.filter((o) => o.stage === 'Won'), lost = s.opportunities.filter((o) => o.stage === 'Lost');
  const sel = s.opportunities.find((o) => o.id === params.get('open'));
  const isNew = params.get('new') === '1';
  const close = () => router.replace('/crm', { scroll: false });

  return (
    <div>
      <PageHeader eyebrow="AI Bidding CRM" title="Bidding & pipeline" subtitle="RFQ intake, feasibility, CPI comparison, margin modelling and bid tracking. Won deals become projects automatically."
        actions={<><DemoBadge /><Segmented label="crm-tab" value={tab} onChange={setTab} options={[{ value: 'pipeline', label: 'Pipeline' }, { value: 'assistant', label: <span className="flex items-center gap-1"><Calculator size={12} />AI bid assistant</span> }]} />
          {canEdit && <Button variant="primary" onClick={() => router.push('/crm?new=1')}><FilePlus2 size={14} /> New RFQ</Button>}</>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="New RFQs" value={s.opportunities.filter((o) => o.stage === 'New RFQ').length} format={(n) => fmtNum(n)} delta={0.25} color="rgb(var(--blue))" />
        <KpiCard label="Open opportunities" value={open.length} format={(n) => fmtNum(n)} />
        <KpiCard label="Quotes awaiting client" value={s.opportunities.filter((o) => o.stage === 'Quote Sent' || o.stage === 'Negotiation').length} format={(n) => fmtNum(n)} color="rgb(var(--orange))" />
        <KpiCard label="Pipeline value" value={sum(open.map((o) => o.value))} format={(n) => fmtMoney(n)} color="rgb(var(--purple))" />
        <KpiCard label="Weighted forecast" value={sum(open.map((o) => o.value * o.probability))} format={(n) => fmtMoney(n)} color="rgb(var(--cyan))" />
        <KpiCard label="Win rate" value={won.length / Math.max(1, won.length + lost.length)} format={(n) => fmtPct(n, 0)} delta={0.04} color="rgb(var(--emerald))" />
        <KpiCard label="Avg gross margin" value={sum(s.opportunities.map((o) => o.margin)) / s.opportunities.length} format={(n) => fmtPct(n)} redacted={!margins} color="rgb(var(--emerald))" />
      </div>

      {tab === 'assistant' ? (
        <Panel><PanelHeader eyebrow="AI bid assistant" title="Quote builder: requirements → vendor CPI → margin options" /><BidAssistant onCreate={(o) => { s.createRfq(o); setTab('pipeline'); }} /></Panel>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2"><SearchInput value={q} onChange={setQ} placeholder="Filter opportunities…" className="w-full sm:w-80" /><span className="ml-auto text-2xs text-ink-3">{canEdit ? 'Drag a deal to change stage. Dropping on Won creates a project.' : 'Read only for your role'}</span></div>
          <div className="mb-6 flex gap-3 overflow-x-auto pb-3">
            {crmStages.map((st) => {
              const items = opps.filter((o) => o.stage === st);
              return (
                <div key={st} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={() => { if (drag) s.moveOpportunity(drag, st); setDrag(null); }}
                  className={cn('panel-solid flex w-[232px] shrink-0 flex-col p-2.5', drag && 'ring-1 ring-cyan/25')}>
                  <div className="mb-2 flex items-center justify-between px-1"><Badge tone={stageTone[st]} dot>{st}</Badge><span className="num text-2xs text-ink-3">{fmtMoney(sum(items.map((o) => o.value)))}</span></div>
                  <div className="space-y-2">
                    {items.map((o) => (
                      <motion.div layout key={o.id} draggable={canEdit} onDragStart={() => setDrag(o.id)} onDragEnd={() => setDrag(null)} onClick={() => router.replace(`/crm?open=${o.id}`, { scroll: false })}
                        role="button" tabIndex={0} className="panel cursor-pointer rounded-xl p-3 hover:ring-1 hover:ring-blue/40">
                        <div className="text-[12.5px] font-semibold leading-snug">{o.title}</div>
                        <div className="text-2xs text-ink-3">{clientName(o.clientId)}</div>
                        <div className="num mt-2 flex items-center justify-between text-[12px]"><span className="font-jakarta font-bold">{fmtMoney(o.value)}</span><Badge tone={o.type === 'Healthcare' ? 'emerald' : o.type === 'B2B' ? 'purple' : 'blue'}>{o.type}</Badge></div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-3/15"><div className="h-full rounded-full bg-gradient-to-r from-blue to-cyan" style={{ width: `${o.probability * 100}%` }} /></div>
                        <div className="mt-1 flex justify-between text-[10px] text-ink-3"><span>{o.owner}</span><span>{fmtPct(o.probability, 0)}</span></div>
                      </motion.div>
                    ))}
                    {!items.length && <div className="rounded-xl border border-dashed hairline py-5 text-center text-2xs text-ink-3">No deals</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel>
              <PanelHeader eyebrow="Funnel" title="Stage conversion" />
              <EChart ariaLabel="Sales funnel" height={260} deps={[s.opportunities]} option={() => ({
                tooltip: { trigger: 'item', formatter: '{b}: {c}' },
                series: [{ type: 'funnel', left: 10, right: 10, top: 6, bottom: 6, gap: 3, sort: 'none', minSize: '18%', label: { color: '#fff', fontSize: 11, formatter: '{b}  {c}' }, itemStyle: { borderWidth: 0 },
                  data: crmStages.slice(0, 6).map((st, i) => ({ name: st, value: s.opportunities.filter((o) => crmStages.indexOf(o.stage) >= i && o.stage !== 'Lost').length, itemStyle: { color: [palette.blue, '#2F7CFB', palette.cyan, palette.purple, palette.magenta, palette.emerald][i] } })) }],
              })} />
            </Panel>
            <Panel>
              <PanelHeader eyebrow="Forecast" title="Revenue: actual vs weighted pipeline" actions={<DemoBadge />} />
              <EChart ariaLabel="Revenue forecast" height={260} deps={[open]} option={(t) => {
                const weighted = sum(open.map((o) => o.value * o.probability));
                const next = ['Nov', 'Dec', 'Jan'];
                return {
                  tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMoney(Number(v)) }, legend: { right: 0 },
                  xAxis: { type: 'category', data: [...months.slice(6), ...next], ...axis(t), splitLine: { show: false } },
                  yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtMoney(v) } },
                  series: [
                    { name: 'Actual', type: 'bar', barWidth: 14, itemStyle: { borderRadius: [4, 4, 0, 0], color: palette.blue }, data: [...monthlyRevenue.slice(6), null, null, null] },
                    { name: 'Forecast', type: 'bar', barWidth: 14, itemStyle: { borderRadius: [4, 4, 0, 0], color: 'rgba(24,215,242,.55)' }, data: [...Array(6).fill(null), monthlyRevenue[11] * 0.97 + weighted * 0.45, monthlyRevenue[11] * 0.9 + weighted * 0.35, monthlyRevenue[11] * 0.95 + weighted * 0.2] },
                  ],
                };
              }} />
            </Panel>
            <Panel>
              <PanelHeader eyebrow="Win / loss" title="Outcomes and loss reasons" />
              <EChart ariaLabel="Win loss" height={260} deps={[s.opportunities]} option={() => ({
                tooltip: { trigger: 'item' },
                series: [{ type: 'pie', radius: ['52%', '78%'], padAngle: 2, itemStyle: { borderRadius: 6 }, label: { color: 'inherit', fontSize: 11 },
                  data: [{ name: 'Won', value: won.length, itemStyle: { color: palette.emerald } }, ...['Price', 'Timeline', 'Feasibility'].map((r, i) => ({ name: `Lost: ${r}`, value: lost.filter((o) => o.lossReason === r).length, itemStyle: { color: [palette.danger, palette.orange, palette.magenta][i] } }))].filter((d) => d.value > 0) }],
              })} />
            </Panel>
          </div>
        </>
      )}

      <Drawer open={!!sel} onClose={close} title={sel?.title ?? ''} subtitle={sel ? `${clientName(sel.clientId)} · ${sel.owner}` : ''}>
        {sel && (
          <div className="space-y-4 text-[12.5px]">
            <div className="flex flex-wrap gap-1.5"><Badge tone={stageTone[sel.stage]} dot>{sel.stage}</Badge><Badge>{sel.type}</Badge>{sel.countries.map((c) => <Badge key={c}>{c}</Badge>)}<DemoBadge /></div>
            <div className="grid grid-cols-2 gap-3">
              {[['Value', fmtMoney(sel.value, false)], ['Margin', margins ? fmtPct(sel.margin) : 'Hidden'], ['Sample', fmtNum(sel.sampleSize)], ['IR / LOI', `${fmtPct(sel.ir, 0)} · ${sel.loi} min`], ['Created', sel.created], ['Last touch', sel.lastTouch]].map(([l, v]) => <div key={l} className="panel-solid p-3"><div className="text-2xs text-ink-3">{l}</div><div className="num font-semibold">{v}</div></div>)}
            </div>
            <div className="eyebrow">Move stage</div>
            <div className="flex flex-wrap gap-1.5">{crmStages.map((st) => <Button key={st} size="sm" variant={st === sel.stage ? 'primary' : 'outline'} disabled={!canEdit} onClick={() => s.moveOpportunity(sel.id, st)}>{st}</Button>)}</div>
            <p className="text-2xs text-ink-3">Moving to Won creates a project in Project Management with this sample size, audience, markets and budget. No re-entry.</p>
          </div>
        )}
      </Drawer>
      <NewRfqDrawer open={isNew} onClose={close} />
    </div>
  );
}

export default function CrmPage() { return <Suspense><CrmInner /></Suspense>; }

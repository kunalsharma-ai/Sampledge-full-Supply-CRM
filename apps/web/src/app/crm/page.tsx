'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { Calculator, FilePlus2, Mail, Sparkles } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { clients, countries, crmStages, vendors, type CrmStage, type Opportunity } from '@/lib/core';
import { allocate, extractRfq, rankVendors, type Audience } from '@/lib/core';
import { access, can, roles } from '@/lib/core';
import { useOS } from '@/lib/store';
import { api } from '@/lib/api';
import { act, fmtCpi, useLive, type Feasibility } from '@/lib/live';
import { palette } from '@/lib/tokens';
import { cn, fmtMoney, fmtNum, fmtPct, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, DemoBadge, Drawer, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader, SearchInput, Segmented } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';

const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
/** New opportunities are owned by whoever creates them (the API applies the same default). */
const ownerName = (s: { session: { user: { name: string } } | null; role: string }) => s.session?.user.name ?? roles.find((r) => r.id === s.role)?.persona.split(' · ')[0] ?? 'Unassigned';
const stageTone: Record<CrmStage, 'blue' | 'cyan' | 'purple' | 'orange' | 'magenta' | 'emerald' | 'danger'> = { 'New RFQ': 'blue', Qualifying: 'cyan', Feasibility: 'purple', 'Quote Sent': 'orange', Negotiation: 'magenta', Won: 'emerald', Lost: 'danger' };

type Extracted = { n?: number; ir?: number; loi?: number; country?: string; audience?: Audience };
type AiRun<T> = { data: T; provider: 'rules' | 'anthropic'; model: string | null; status: string; note: string };
type RfqOut = { audience: Audience | null; countries: string[]; sampleSize: number | null; incidence: number | null; loi: number | null; title: string | null; missing: string[] };

/** RFQ text → requirements: the AI gateway when signed in (rules or Claude, server-side), core rules offline. */
async function extract(text: string, live: boolean): Promise<{ fields: Extracted; note: string; missing: string[] }> {
  if (live) {
    const r = await api<AiRun<RfqOut>>('/ai/rfq-extract', { method: 'POST', body: { text } });
    const d = r.data;
    return { fields: { n: d.sampleSize ?? undefined, ir: d.incidence ?? undefined, loi: d.loi ?? undefined, country: d.countries[0], audience: d.audience ?? undefined }, note: r.note, missing: d.missing };
  }
  const e = extractRfq(text, countries);
  return { fields: { n: e.n, ir: e.ir, loi: e.loi, country: e.countries[0], audience: e.audience }, note: 'Rule-based extraction in the browser (offline demo)', missing: [] };
}

function BidAssistant({ onCreate }: { onCreate: (o: Omit<Opportunity, 'id' | 'stage' | 'probability' | 'created' | 'lastTouch' | 'demo'>) => void }) {
  const role = useOS((s) => s.role);
  const margins = can(role, 'view:margins');
  const owner = useOS(ownerName);
  const [picked, setClientId] = useState('');
  const clientId = picked || clients[0]?.id || '';
  const [audience, setAudience] = useState<Audience>('B2B');
  const [country, setCountry] = useState('DE');
  const [n, setN] = useState(500);
  const [ir, setIr] = useState(0.25);
  const [loi, setLoi] = useState(15);
  const [rfqText, setRfqText] = useState('Hi team, can you quote 500 B2B IT decision-makers in Germany, 15 minute survey, approx 25% incidence? Need field in two weeks.');
  const [extracted, setExtracted] = useState<Awaited<ReturnType<typeof extract>> | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useOS((s) => s.mode === 'live' && !!s.session);
  const q = { audience, country, n, ir, loi };
  const ranked = useMemo(() => rankVendors(q, vendors), [audience, country, n, ir, loi]); // eslint-disable-line react-hooks/exhaustive-deps
  const alloc = useMemo(() => allocate(q, ranked), [ranked]); // eslint-disable-line react-hooks/exhaustive-deps
  const cost = alloc.blendedCpi * (n - alloc.shortfall);
  const prices = [1.3, 1.45, 1.6].map((mk) => ({ mk, cpi: alloc.blendedCpi * mk, revenue: alloc.blendedCpi * mk * n, margin: 1 - 1 / mk }));

  const runExtract = async () => {
    setBusy(true);
    try {
      const r = await extract(rfqText, live);
      setExtracted(r);
      const e = r.fields;
      if (e.n) setN(e.n); if (e.ir) setIr(e.ir); if (e.loi) setLoi(e.loi); if (e.country) setCountry(e.country); if (e.audience) setAudience(e.audience);
    } catch (err) {
      useOS.getState().toast(err instanceof Error ? err.message : 'Extraction failed', 'warn');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="panel-solid p-4">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold"><Mail size={14} className="text-cyan" /> Email-to-RFQ</div>
          <textarea value={rfqText} onChange={(e) => setRfqText(e.target.value)} rows={4} className={cn(inputCls, 'h-auto py-2 leading-relaxed')} aria-label="RFQ email text" />
          <Button size="sm" variant="subtle" className="mt-2 w-full" onClick={runExtract} disabled={busy}><Sparkles size={13} /> {busy ? 'Extracting…' : 'Extract requirements'}</Button>
          {extracted && (
            <div className="mt-2 flex flex-wrap gap-1 text-2xs">
              {Object.entries(extracted.fields).map(([k, v]) => <Badge key={k} tone={v === undefined ? 'danger' : 'emerald'}>{k}: {v === undefined ? 'not found' : k === 'ir' ? fmtPct(v as number, 0) : String(v)}</Badge>)}
              {extracted.missing.map((m) => <Badge key={m} tone="orange">missing: {m}</Badge>)}
              <div className="w-full pt-1 text-ink-3">{extracted.note}</div>
            </div>
          )}
        </div>
        <Field label="Client"><select aria-label="Client" className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
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
        {!ranked.length ? <EmptyState title="No vendor covers this audience and market" body="Try another country or audience. Feasibility requests go to vendors that cover the market." /> : (
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
                  <Button size="sm" className="mt-3 w-full" disabled={!clientId} onClick={() => onCreate({ title: `${audience} study · ${countries.find((c) => c.code === country)?.name} (n=${n})`, clientId, owner, value: Math.round(p.revenue), margin: +p.margin.toFixed(3), type: audience, countries: [country], sampleSize: n, ir, loi })}>
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

/** Supplier feasibility for one opportunity (live API only). Answers come from vendors in their portal. */
function FeasibilitySection({ oppId, stage, canEdit }: { oppId: string; stage: CrmStage; canEdit: boolean }) {
  const role = useOS((s) => s.role);
  const [tick, setTick] = useState(0);
  const q = useLive<Feasibility[]>(`/opportunities/${oppId}/feasibility`, [tick, oppId]);
  if (!q.live) return null;
  const closed = stage === 'Won' || stage === 'Lost';
  const ask = () => act(() => api<{ created: number; skipped: number }>(`/opportunities/${oppId}/feasibility`, { method: 'POST', body: {} }), (r) => (r.created ? `Sent to ${r.created} vendor(s). Answers arrive in their portal.` : 'Every ranked vendor has already been asked')).then(() => setTick((t) => t + 1));
  const rows = q.data ?? [];
  const answered = rows.filter((r) => r.status === 'responded').length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="eyebrow">Supplier feasibility {rows.length ? `· ${answered}/${rows.length} answered` : ''}</div>
        {canEdit && !closed && <Button size="sm" variant={rows.length ? 'outline' : 'primary'} onClick={ask}><Mail size={12} /> {rows.length ? 'Ask more vendors' : 'Request feasibility'}</Button>}
      </div>
      {rows.length ? (
        <div className="space-y-1.5">
          {rows.map((f) => (
            <div key={f.id} className="panel-solid flex items-center gap-2 px-3 py-2">
              <span className="font-medium">{f.vendorName}</span><Badge>{f.country}</Badge>
              <span className="ml-auto" />
              {f.status === 'responded' ? <span className="num text-ink-2">{f.cpi != null ? `${fmtCpi(f.cpi)} · ` : can(role, 'view:vendor_bids') ? '' : 'Bid hidden · '}{fmtNum(f.capacity ?? 0)} cap.</span> : null}
              <Badge tone={f.status === 'responded' ? 'emerald' : f.status === 'declined' ? 'neutral' : 'orange'} dot>{f.status === 'sent' ? 'Waiting' : f.status}</Badge>
            </div>
          ))}
          <p className="text-2xs text-ink-3">Drafted quotes use the lowest answered CPI per market (supplier-confirmed). Markets without answers fall back to the rate-card estimate and are labelled as such.</p>
        </div>
      ) : <p className="text-2xs text-ink-3">No vendor has been asked yet. Until they answer, any quote is a rate-card estimate, not a supplier confirmation.</p>}
    </div>
  );
}

function NewRfqDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useOS((s) => s.createRfq);
  const owner = useOS(ownerName);
  const [form, setF] = useState({ title: '', clientId: '', type: 'B2C' as Audience, country: 'US', n: 1000, ir: 0.5, loi: 12, value: 8000 });
  const f = { ...form, clientId: form.clientId || clients[0]?.id || '' };
  const valid = f.title.trim().length > 2 && f.n > 0 && !!f.clientId;
  return (
    <Drawer open={open} onClose={onClose} title="New RFQ" subtitle="Creates an opportunity in New RFQ. Visible to Projects and Finance once won.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!valid) return; create({ title: f.title, clientId: f.clientId, owner, value: f.value, margin: 0.4, type: f.type, countries: [f.country], sampleSize: f.n, ir: f.ir, loi: f.loi }); onClose(); }}>
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
  const [lostAsk, setLostAsk] = useState<string | null>(null);
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
        <KpiCard label="New RFQs" value={s.opportunities.filter((o) => o.stage === 'New RFQ').length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="Open opportunities" value={open.length} format={(n) => fmtNum(n)} />
        <KpiCard label="Quotes awaiting client" value={s.opportunities.filter((o) => o.stage === 'Quote Sent' || o.stage === 'Negotiation').length} format={(n) => fmtNum(n)} color="rgb(var(--orange))" />
        <KpiCard label="Pipeline value" value={sum(open.map((o) => o.value))} format={(n) => fmtMoney(n)} color="rgb(var(--purple))" />
        <KpiCard label="Weighted forecast" value={sum(open.map((o) => o.value * o.probability))} format={(n) => fmtMoney(n)} color="rgb(var(--cyan))" />
        <KpiCard label="Win rate" value={won.length / Math.max(1, won.length + lost.length)} format={(n) => fmtPct(n, 0)} color="rgb(var(--emerald))" />
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
                <div key={st} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={() => { if (drag) { if (st === 'Lost') { setLostAsk(drag); router.replace(`/crm?open=${drag}`, { scroll: false }); } else s.moveOpportunity(drag, st); } setDrag(null); }}
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
                series: [{ type: 'funnel', left: 10, right: 10, top: 6, bottom: 6, gap: 3, sort: 'none', minSize: '18%', label: { position: 'inside', color: '#fff', fontSize: 11, formatter: '{b}  {c}' }, itemStyle: { borderWidth: 0 },
                  data: crmStages.slice(0, 6).map((st, i) => ({ name: st, value: s.opportunities.filter((o) => crmStages.indexOf(o.stage) >= i && o.stage !== 'Lost').length, itemStyle: { color: [palette.blue, '#2F7CFB', palette.cyan, palette.purple, palette.magenta, palette.emerald][i] } })) }],
              })} />
            </Panel>
            <RevenueForecast />
            <Panel>
              <PanelHeader eyebrow="Win / loss" title="Outcomes and loss reasons" />
              <EChart ariaLabel="Win loss" height={260} deps={[s.opportunities]} option={() => ({
                tooltip: { trigger: 'item' },
                series: [{ type: 'pie', radius: ['44%', '66%'], padAngle: 2, itemStyle: { borderRadius: 6 }, label: { color: 'inherit', fontSize: 11, formatter: '{b}\n{c}', alignTo: 'edge', edgeDistance: 6, overflow: 'none' }, labelLine: { length: 8, length2: 0 },
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
            <div className="flex flex-wrap gap-1.5">{crmStages.map((st) => <Button key={st} size="sm" variant={st === sel.stage ? 'primary' : 'outline'} disabled={!canEdit} onClick={() => (st === 'Lost' ? setLostAsk(sel.id) : s.moveOpportunity(sel.id, st))}>{st}</Button>)}</div>
            {lostAsk === sel.id && sel.stage !== 'Lost' && (
              <div className="panel-solid p-3">
                <div className="text-2xs text-ink-3">Why was it lost? The reason feeds win/loss analysis.</div>
                <div className="mt-2 flex flex-wrap gap-1.5">{['Price', 'Timeline', 'Feasibility', 'Other'].map((r) => <Button key={r} size="sm" variant="outline" onClick={() => { s.moveOpportunity(sel.id, 'Lost', r); setLostAsk(null); }}>{r}</Button>)}</div>
              </div>
            )}
            <FeasibilitySection oppId={sel.id} stage={sel.stage} canEdit={canEdit} />
            <p className="text-2xs text-ink-3">Moving to Won creates a project in Project Management with this sample size, audience, markets and budget. No re-entry.</p>
          </div>
        )}
      </Drawer>
      <NewRfqDrawer open={isNew} onClose={close} />
    </div>
  );
}

export default function CrmPage() { return <Suspense><CrmInner /></Suspense>; }

type Revenue = { currency: string; months: { month: string; revenue: number }[]; forecast: { month: string; draftInvoices: number; weightedPipeline: number }[]; weightedPipeline: number; openOpportunities: number };
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** Last six months of invoiced revenue, then draft invoices and the probability-weighted open pipeline. */
function RevenueForecast() {
  const opps = useOS((s) => s.opportunities);
  const { data: r, error } = useLive<Revenue>('/crm/insights/revenue', [opps]);
  const recent = r?.months.slice(-6) ?? [];
  const empty = !!r && !recent.some((m) => m.revenue) && r.weightedPipeline === 0;
  return (
    <Panel>
      <PanelHeader eyebrow="Forecast" title="Invoiced revenue vs weighted pipeline" actions={r && <span className="text-2xs text-ink-3">{r.openOpportunities} open · {r.currency}</span>} />
      {error ? <EmptyState title="Forecast unavailable" body={error} /> : !r ? <div className="h-[260px] animate-pulse rounded-xl bg-white/5" /> : empty ? <EmptyState title="No invoices or open opportunities" body="Issued invoices and weighted open deals appear here." /> : (
        <EChart ariaLabel="Revenue forecast" height={260} deps={[r]} option={(t) => ({
          tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : fmtMoney(Number(v))) }, legend: { right: 0 },
          xAxis: { type: 'category', data: [...recent.map((m) => monthLabel(m.month)), ...r.forecast.map((f) => monthLabel(f.month))], ...axis(t), splitLine: { show: false } },
          yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtMoney(v) } },
          series: [
            { name: 'Invoiced', type: 'bar', barWidth: 14, stack: 'r', itemStyle: { borderRadius: [4, 4, 0, 0], color: palette.blue }, data: [...recent.map((m) => m.revenue), null, null, null] },
            { name: 'Draft invoices', type: 'bar', barWidth: 14, stack: 'r', itemStyle: { color: 'rgba(36,107,253,.45)' }, data: [...Array(recent.length).fill(null), ...r.forecast.map((f) => f.draftInvoices || null)] },
            { name: 'Weighted pipeline', type: 'bar', barWidth: 14, stack: 'r', itemStyle: { borderRadius: [4, 4, 0, 0], color: 'rgba(24,215,242,.55)' }, data: [...Array(recent.length).fill(null), ...r.forecast.map((f) => f.weightedPipeline || null)] },
          ],
        })} />
      )}
    </Panel>
  );
}

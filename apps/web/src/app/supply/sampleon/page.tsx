'use client';
/**
 * Screen 19 · SAMPLEON Audience Allocation. One workspace for every audience request that PROJEXA
 * projects and ZAPX surveys send through SAMPLEON. Top: the pipeline by contract status
 * (submitted → feasibility ready → approved → soft launch → live → closed). Below: the selected
 * request, with feasibility from SUPPLY360 counts, the panel allocation (points of 100, checked
 * inline), quota cells, batches and delivery, and the event log in contract event names.
 * Approving an allocation sends `audience.approved` to SAMPLEON, so it asks for confirmation.
 * Integration: `GET /sampleon/v1/audience-requests` (planned), `POST /sampleon/v1/audience-requests/:id/approve` (planned),
 * staff overview `GET /panels/sampleon/overview` (live: the "Recorded in SUPPLY360" strip shows the real
 * survey card, participation and reward totals when signed in to the API; the pipeline is still demo).
 */
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { CheckCircle2, CirclePause, CirclePlay, Rocket, Sparkles, TriangleAlert } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { Badge, Bar, Button, Panel, SearchInput, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Tabs, TabsContent, TabsList } from '@/components/ui/overlay';
import { CountryChips, KpiTile, PanelChip, ProductChip, SampAudienceLogo, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { InfoTip } from '@/components/supply/info-tip';
import { sectionHelp } from '@/lib/supply/help';
import { useSupplyData } from '@/lib/supply/data';
import { cardStatus, loadSampOverview, participationStatus, type SampOverview } from '@/lib/supply/live';
import { pipelineStages, sampleonRequests, type FlowEvent, type SampleonRequest, type SampleonStatus } from '@/lib/supply/connected';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const screen = screenBySlug('sampleon')!;
const stageOf = (s: SampleonStatus): SampleonStatus => (s === 'paused' ? 'live' : s === 'draft' ? 'submitted' : s);
const statusLabel: Record<SampleonStatus, string> = { draft: 'Draft', submitted: 'Submitted', feasibility_ready: 'Feasibility ready', approved: 'Approved', soft_launch: 'Soft launch', live: 'Live', paused: 'Paused', closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled' };

export default function Page() { return <Suspense><Sampleon /></Suspense>; }

function Sampleon() {
  const params = useSearchParams();
  const toast = useOS((s) => s.toast);
  const [items, setItems] = useState(sampleonRequests);
  const [src, setSrc] = useState<'all' | 'PROJEXA' | 'ZAPX'>('all');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string>(params.get('r') ?? sampleonRequests.find((r) => r.status === 'feasibility_ready')!.id);

  const shown = useMemo(() => items.filter((r) => (src === 'all' || r.platform === src) && (!q || `${r.id} ${r.title} ${r.client} ${r.projectId ?? ''} ${r.surveyId}`.toLowerCase().includes(q.toLowerCase()))), [items, src, q]);
  const sel = items.find((r) => r.id === selId) ?? items[0];
  const update = (id: string, patch: Partial<SampleonRequest>, ev?: Omit<FlowEvent, 'id' | 'at'>) =>
    setItems((l) => l.map((r) => (r.id === id ? { ...r, ...patch, events: ev ? [{ ...ev, id: `x-${Date.now()}`, at: 'just now' }, ...r.events] : r.events } : r)));

  const inFlight = items.filter((r) => ['soft_launch', 'live', 'paused'].includes(r.status));
  const required = inFlight.reduce((a, r) => a + r.requiredCompletes, 0), done = inFlight.reduce((a, r) => a + r.completes, 0);
  const delivered = items.reduce((a, r) => a + r.batches.delivered, 0), suppressed = items.reduce((a, r) => a + r.batches.suppressed, 0);
  const overview = useSupplyData<SampOverview | null>('samp:overview', () => null, loadSampOverview);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={overview.source === 'live' ? 'mixed' : 'demo'} title={<span className="flex flex-wrap items-center gap-3"><SampAudienceLogo height={44} /> <span>Audience allocation</span></span>}
        subtitle="Requests from PROJEXA projects and ZAPX surveys, from feasibility to closed. SUPPLY360 does the counting and delivery; names and e-mail addresses never leave SUPPLY360." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Requests in the pipeline" value={items.filter((r) => !['closed', 'rejected', 'cancelled'].includes(r.status)).length} format="int" hint="Submitted, waiting for allocation, approved or in field" />
        <KpiTile label="Waiting for allocation" value={items.filter((r) => r.status === 'feasibility_ready').length} format="int" hint="Feasibility is back from SUPPLY360; a person needs to approve the panel split" />
        <KpiTile label="Fieldwork progress" value={done / (required || 1)} format="pct" hint={`${fmtNum(done)} of ${fmtNum(required)} verified completes across ${inFlight.length} requests in field`} />
        <KpiTile label="Suppressed at delivery" value={suppressed / (delivered || 1)} format="pct" good="down" hint="Invitations SUPPLY360 did not send: no research consent, fatigue cap or recent participation" />
      </div>

      {overview.source === 'live' && overview.data && <LiveOverview o={overview.data} />}

      <Panel className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b hairline p-3">
          <span className="text-[13px] font-semibold">Pipeline</span><InfoTip entry={sectionHelp('sampleon', 'Pipeline')} label="Pipeline" />{overview.source === 'live' && <Badge tone="neutral">Demo requests</Badge>}
          <Segmented label="Source" size="sm" value={src} onChange={setSrc} options={[{ value: 'all', label: 'All sources' }, { value: 'PROJEXA', label: 'PROJEXA' }, { value: 'ZAPX', label: 'ZAPX' }]} />
          <SearchInput value={q} onChange={setQ} placeholder="Request, project, survey or client…" className="ml-auto w-full sm:w-64" />
        </div>
        <div className="grid gap-2 overflow-x-auto p-3 md:grid-cols-3 xl:grid-cols-6">
          {pipelineStages.map((st) => {
            const col = shown.filter((r) => stageOf(r.status) === st.key);
            return (
              <section key={st.key} aria-labelledby={`st-${st.key}`} className="min-w-[180px] rounded-xl bg-surface-2/30 p-2">
                <h3 id={`st-${st.key}`} className="mb-2 flex items-center justify-between px-1 text-2xs font-semibold text-ink-2" title={st.hint}>{st.label}<span className="num rounded-full bg-ink-3/15 px-1.5 text-[10px]">{col.length}</span></h3>
                <ul className="space-y-1.5">
                  {col.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => setSelId(r.id)} aria-pressed={r.id === sel.id} aria-label={`${r.title}, ${statusLabel[r.status]}`}
                        className={cn('w-full rounded-lg border bg-surface p-2 text-left transition-shadow hover:shadow-lift', r.id === sel.id ? 'border-primary/60 ring-1 ring-primary/30' : 'hairline')}>
                        <div className="flex items-center justify-between gap-1"><ProductChip product={r.platform === 'PROJEXA' ? 'projexa' : 'zapx'} />{r.status === 'paused' && <Badge tone="warn">Paused</Badge>}{r.healthcare && r.status !== 'paused' && <PanelChip panel="mho" short />}</div>
                        <div className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug">{r.title}</div>
                        <div className="mt-1 flex items-center justify-between text-[10.5px] text-ink-3"><span className="font-mono">{r.id}</span><CountryChips codes={r.countries} max={2} /></div>
                        {r.completes > 0 && <Bar value={r.completes / r.requiredCompletes} tone={r.status === 'closed' ? 'emerald' : 'blue'} className="mt-1.5" />}
                      </button>
                    </li>
                  ))}
                  {col.length === 0 && <li className="px-1 py-3 text-center text-2xs text-ink-3">None</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>

      {sel && <Workspace key={sel.id} r={sel} update={update} toast={toast} />}
    </div>
  );
}

function Workspace({ r, update, toast }: { r: SampleonRequest; update: (id: string, p: Partial<SampleonRequest>, ev?: Omit<FlowEvent, 'id' | 'at'>) => void; toast: (t: string, tone?: 'ok' | 'warn' | 'info') => void }) {
  const f = r.feasibility;
  const suggest = (): Record<PanelId, number> => {
    const t = f.byPanel.t2o + f.byPanel.mfr + f.byPanel.mho || 1;
    const a = Math.round((f.byPanel.t2o / t) * 100), b = Math.round((f.byPanel.mfr / t) * 100);
    return { t2o: a, mfr: b, mho: 100 - a - b };
  };
  const [alloc, setAlloc] = useState<Record<PanelId, number>>(r.allocation ?? suggest());
  const [confirm, setConfirm] = useState<null | 'approve' | 'pause' | 'soft'>(null);
  const sum = alloc.t2o + alloc.mfr + alloc.mho;
  const editable = r.status === 'feasibility_ready';
  const hcWarn = r.healthcare && (alloc.t2o > 0 || alloc.mfr > 0);
  const deadPanel = (Object.keys(alloc) as PanelId[]).find((p) => alloc[p] > 0 && f.byPanel[p] === 0);
  const error = sum !== 100 ? `Adds up to ${sum}; it must be 100.` : deadPanel ? `${panelBrands.find((b) => b.id === deadPanel)!.short} has no reachable panellists for this audience.` : null;
  const pct = r.completes / r.requiredCompletes;

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3"><span className="font-mono">{r.id}</span><ProductChip product={r.platform === 'PROJEXA' ? 'projexa' : 'zapx'}>{r.platform} {r.platform === 'PROJEXA' ? r.projectId : r.surveyId}</ProductChip>{r.platform === 'PROJEXA' && <span>survey {r.surveyId} on ZAPX</span>}{r.platform === 'ZAPX' && r.projectId && <span>linked to {r.projectId}</span>}<Badge tone={r.status === 'paused' ? 'warn' : r.status === 'live' ? 'emerald' : 'neutral'}>{statusLabel[r.status]}</Badge></div>
          <h2 className="mt-1 flex items-center gap-1 font-display text-lg font-semibold">{r.title}<InfoTip entry={sectionHelp('sampleon', 'Selected request')} label="This request" /></h2>
          <p className="text-[12.5px] text-ink-2">{r.client} · {fmtNum(r.requiredCompletes)} completes · IR {fmt.pct(r.ir)} · LOI {r.loi} min · {fmtNum(r.rewardPoints)} points · fieldwork {r.fieldwork.start} to {r.fieldwork.end}</p>
          <p className="mt-1 flex items-start gap-1.5 text-2xs text-ink-3"><Sparkles size={12} className="mt-px shrink-0 text-purple" aria-hidden />“{r.naturalLanguage}” → {r.criteria.join(' AND ')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.status === 'approved' && <Button size="sm" onClick={() => setConfirm('soft')}><Rocket size={13} /> Schedule soft launch</Button>}
          {r.status === 'soft_launch' && <Link href="/supply/launch" className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20"><Rocket size={13} /> Read-out and full launch</Link>}
          {r.status === 'live' && <Button size="sm" variant="ghost" onClick={() => setConfirm('pause')}><CirclePause size={13} /> Pause</Button>}
          {r.status === 'paused' && <Button size="sm" onClick={() => { update(r.id, { status: 'live' }, { type: 'batch.scheduled', text: 'Resumed: next batch scheduled' }); toast(`${r.id} resumed`, 'ok'); }}><CirclePlay size={13} /> Resume</Button>}
        </div>
      </div>
      {r.completes > 0 && <div className="mt-3 max-w-md text-2xs text-ink-3"><div className="flex justify-between"><span>Verified completes</span><span className="num">{fmtNum(r.completes)} / {fmtNum(r.requiredCompletes)} · {Math.round(pct * 100)}%</span></div><Bar value={pct} className="mt-1" /></div>}

      <Tabs defaultValue="feasibility" className="mt-4">
        <TabsList tabs={[{ value: 'feasibility', label: 'Feasibility and allocation' }, { value: 'quotas', label: 'Quotas', count: r.quotas.length }, { value: 'delivery', label: 'Batches and delivery' }, { value: 'events', label: 'Events', count: r.events.length }]} />

        <TabsContent value="feasibility" className="pt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['Eligible', f.eligible], ['Reachable', f.reachable], ['Estimated completes', f.estimatedCompletes], ['Shortfall', f.shortfall]].map(([l, v]) => (
                  <div key={l as string} className="panel-solid p-2.5"><div className="text-2xs text-ink-3">{l}</div><div className={cn('num font-jakarta text-lg font-bold', l === 'Shortfall' && (v as number) > 0 && 'text-warn')}>{fmtNum(v as number)}</div></div>
                ))}
              </div>
              <p className={cn('mt-2 flex items-center gap-1.5 text-[12px]', f.feasible ? 'text-emerald' : 'text-warn')}>{f.feasible ? <CheckCircle2 size={13} /> : <TriangleAlert size={13} />}{f.feasible ? 'Feasible at the requested IR and fieldwork dates.' : `Short by ${fmtNum(f.shortfall)}. Widen countries, extend fieldwork or ask the source to lower the target.`}</p>
              <table className="mt-3 w-full text-[12.5px]">
                <caption className="sr-only">Feasibility by country</caption>
                <thead><tr className="text-left text-2xs text-ink-3"><th scope="col" className="py-1 font-semibold">Country</th><th scope="col" className="py-1 text-right font-semibold">Eligible</th><th scope="col" className="py-1 text-right font-semibold">Reachable</th><th scope="col" className="py-1 text-right font-semibold">Est. completes</th></tr></thead>
                <tbody>{Object.entries(f.byCountry).map(([c, v]) => <tr key={c} className="border-t hairline"><th scope="row" className="py-1.5 text-left font-mono text-[11.5px] font-semibold">{c}</th><td className="num py-1.5 text-right">{fmtNum(v.eligible)}</td><td className="num py-1.5 text-right">{fmtNum(v.reachable)}</td><td className="num py-1.5 text-right">{fmtNum(v.estimatedCompletes)}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="rounded-xl border hairline p-3">
              <SectionTitle eyebrow="Points of 100" title="Panel allocation" actions={editable && <Button size="xs" variant="ghost" onClick={() => setAlloc(suggest())}>Split by reach</Button>} />
              <ul className="space-y-3">
                {panelBrands.map((b) => (
                  <li key={b.id}>
                    <div className="flex items-center justify-between gap-2 text-[12px]"><PanelChip panel={b.id} /><span className="text-2xs text-ink-3">{fmtCompact(f.byPanel[b.id])} reachable</span></div>
                    <div className="mt-1 flex items-center gap-2">
                      <input type="range" min={0} max={100} value={alloc[b.id]} disabled={!editable} aria-label={`${b.name} share`} onChange={(e) => setAlloc((a) => ({ ...a, [b.id]: Number(e.target.value) }))} className="h-6 flex-1 accent-[rgb(var(--primary))]" />
                      <input type="number" min={0} max={100} value={alloc[b.id]} disabled={!editable} aria-label={`${b.name} share, number`} aria-invalid={!!error} onChange={(e) => setAlloc((a) => ({ ...a, [b.id]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} className={cn(inputCls, 'h-8 w-16 px-2 text-right num')} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full" aria-hidden>{panelBrands.map((b) => <motion.span key={b.id} animate={{ width: `${(alloc[b.id] / Math.max(100, sum)) * 100}%` }} style={{ background: b.color }} />)}</div>
              <p className={cn('mt-2 text-2xs', error ? 'text-danger' : 'text-ink-3')} role={error ? 'alert' : undefined}>{error ?? `Total ${sum}.`}</p>
              {hcWarn && <p className="mt-1 text-2xs text-warn">Health criteria only match panellists with health-data consent, which is almost all on MyHealthOpinions.</p>}
              {editable
                ? <Button size="sm" className="mt-3 w-full" disabled={!!error} onClick={() => setConfirm('approve')}><CheckCircle2 size={13} /> Approve allocation</Button>
                : <p className="mt-3 text-2xs text-ink-3">{r.status === 'submitted' ? 'Waiting for feasibility from SUPPLY360.' : 'Allocation approved. Change it from the quota screen while in field.'}</p>}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="quotas" className="pt-4">
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">Quota cells for {r.id}</caption>
            <thead><tr className="text-left text-2xs text-ink-3"><th scope="col" className="py-1 font-semibold">Cell</th><th scope="col" className="py-1 font-semibold">SUPPLY360 condition</th><th scope="col" className="py-1 font-semibold">Progress</th><th scope="col" className="py-1 text-right font-semibold">Completes</th></tr></thead>
            <tbody>{r.quotas.map((qc) => (
              <tr key={qc.id} className="border-t hairline">
                <th scope="row" className="py-2 text-left font-medium">{qc.label}{qc.question && <span className="block text-2xs font-normal text-ink-3">{qc.question}</span>}</th>
                <td className="py-2">{qc.mapped ? <code className="rounded bg-ink-3/10 px-1.5 py-0.5 text-[11px]">{qc.condition}</code> : <span className="text-2xs text-warn">Not mapped yet: map the question in PROJEXA</span>}</td>
                <td className="w-40 py-2"><Bar value={qc.completes / qc.target} tone={qc.full ? 'emerald' : 'blue'} /></td>
                <td className="num py-2 text-right">{fmtNum(qc.completes)} / {fmtNum(qc.target)}{qc.full && <Badge tone="emerald" className="ml-1.5">Full</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
          <Link href="/supply/quotas" className="mt-2 inline-block text-2xs text-primary hover:underline">Open quota monitoring</Link>
        </TabsContent>

        <TabsContent value="delivery" className="pt-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Batches sent', r.batches.sent], ['Scheduled', r.batches.scheduled], ['Delivered', r.batches.delivered], ['Suppressed', r.batches.suppressed]].map(([l, v]) => <div key={l as string} className="panel-solid p-2.5"><div className="text-2xs text-ink-3">{l}</div><div className="num font-jakarta text-lg font-bold">{fmtNum(v as number)}</div></div>)}
          </div>
          <p className="mt-2 text-2xs text-ink-3">SUPPLY360 delivers a survey card on the panel website and one e-mail per panel. Panellists without research consent, over the weekly fatigue cap, or who took part in an excluded survey are suppressed with a reason.</p>
          <Link href="/supply/batches" className="mt-2 inline-block text-2xs text-primary hover:underline">Open batch scheduling</Link>
        </TabsContent>

        <TabsContent value="events" className="pt-4">
          <ol className="space-y-2">{r.events.map((e) => <li key={e.id} className="flex items-start gap-3 text-[12.5px]"><span className="num w-16 shrink-0 text-2xs text-ink-3">{e.at}</span><code className="shrink-0 rounded bg-ink-3/10 px-1.5 py-0.5 text-[10.5px]">{e.type}</code><span className="min-w-0 text-ink-2">{e.text}</span></li>)}</ol>
        </TabsContent>
      </Tabs>

      <ConfirmDialog open={confirm === 'approve'} onOpenChange={(v) => !v && setConfirm(null)} tone="primary" title="Approve this allocation?"
        body={<>SampAudience will plan batches for {r.id} with T2O {alloc.t2o}, MFR {alloc.mfr} and MHO {alloc.mho}, and {r.platform} will see the request as approved. You can still pause before the first batch goes out.</>}
        confirmLabel="Approve" onConfirm={() => { update(r.id, { status: 'approved', allocation: alloc }, { type: 'audience.approved', text: `Allocation approved: T2O ${alloc.t2o}, MFR ${alloc.mfr}, MHO ${alloc.mho}` }); toast(`${r.id} approved; ${r.platform} notified`, 'ok'); }} />
      <ConfirmDialog open={confirm === 'soft'} onOpenChange={(v) => !v && setConfirm(null)} tone="primary" title="Schedule the soft launch?"
        body={`The first batch goes to about ${fmtNum(Math.round(r.requiredCompletes * 0.1 / Math.max(0.05, r.ir)))} panellists at the next send window in each country, for a read-out before full launch.`}
        confirmLabel="Schedule" onConfirm={() => { update(r.id, { status: 'soft_launch' }, { type: 'batch.scheduled', text: 'Soft-launch batch scheduled' }); toast(`Soft launch scheduled for ${r.id}`, 'ok'); }} />
      <ConfirmDialog open={confirm === 'pause'} onOpenChange={(v) => !v && setConfirm(null)} title="Pause fieldwork?"
        body="No new batches go out and open survey cards are hidden from panellists. Respondents already in the survey can finish." confirmLabel="Pause"
        onConfirm={() => { update(r.id, { status: 'paused' }); toast(`${r.id} paused`, 'info'); }} />
    </Panel>
  );
}

/** Real totals from SUPPLY360's own tables: the survey cards SampAudience placed and what came back. */
function LiveOverview({ o }: { o: SampOverview }) {
  const cards = Object.values(o.cards).reduce((a, n) => a + n, 0), parts = Object.values(o.participation).reduce((a, n) => a + n, 0);
  const extra = (known: { key: string }[], got: Record<string, number>) => Object.keys(got).filter((k) => !known.some((x) => x.key === k)).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
  const row = (title: string, known: { key: string; label: string }[], got: Record<string, number>, total: number) => (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]"><span className="font-semibold">{title}</span><span className="num text-ink-2">{fmtNum(total)}</span></div>
      <dl className="flex flex-wrap gap-1.5">{[...known, ...extra(known, got)].map((s) => <div key={s.key} className="rounded-lg bg-surface-2/60 px-2 py-1 text-2xs"><dt className="inline text-ink-3">{s.label} </dt><dd className="num inline font-semibold">{fmtNum(got[s.key] ?? 0)}</dd></div>)}</dl>
    </div>
  );
  return (
    <Panel className="p-4" aria-labelledby="samp-live">
      <SectionTitle id="samp-live" eyebrow="Live" title="Recorded in SUPPLY360" />
      {cards + parts === 0 && o.rewardPointsNet === 0
        ? <p className="text-[12.5px] text-ink-2">SampAudience hasn’t placed any survey cards with this workspace’s panellists yet. Cards, survey outcomes and rewards appear here as soon as it does.</p>
        : <div className="grid gap-4 md:grid-cols-[1fr_1fr_180px]">
            {row('Survey cards placed', cardStatus, o.cards, cards)}
            {row('Survey outcomes received', participationStatus, o.participation, parts)}
            <div><div className="text-[12.5px] font-semibold">Reward points credited</div><div className="num mt-1 font-display text-[22px] font-bold">{fmtNum(o.rewardPointsNet)}</div><p className="text-2xs text-ink-3">Net of reversals, from SampAudience outcomes</p></div>
          </div>}
    </Panel>
  );
}

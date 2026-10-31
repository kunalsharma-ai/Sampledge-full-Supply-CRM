'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { act, shortDate, useLive } from '@/lib/live';
import { fmtMoney, fmtNum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, Field, Panel, PanelHeader, inputCls } from '@/components/ui/primitives';
import { DataTable, Loadable } from '@/components/ui/data';

const smallInput = `${inputCls.replace('w-full', '')} h-8`;
const money = (n: number, c: string, digits = 2) => Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);

// ---- Reconciliation ------------------------------------------------------------------------------

type Rec = { id: string; number: string; vendorName?: string; projectCode?: string; currency: string; cpi: number; ordered: number; recordedCompletes: number; accepted: number | null; orderedAmount: number; payableAmount: number | null; payableStatus: string | null; variance: number | null; reconciledAt: string | null; note: string | null };

function ReconcileRow({ r, write, onDone }: { r: Rec; write: boolean; onDone: () => void }) {
  const [n, setN] = useState(String(r.ordered));
  const [note, setNote] = useState('');
  if (r.reconciledAt) return <span className="text-2xs text-ink-3">Reconciled {shortDate(r.reconciledAt)}{r.note ? ` · ${r.note}` : ''}</span>;
  if (!write) return null;
  if (r.payableStatus !== 'open') return <span className="text-2xs text-ink-3">{r.payableStatus === 'paid' ? 'Paid before reconciliation' : 'Payment awaiting approval'}</span>;
  const k = Number(n);
  const short = Number.isInteger(k) && k < r.ordered;
  const save = () => act(() => api(`/finance/reconciliation/${r.id}`, { method: 'POST', body: { acceptedCompletes: k, note: note || undefined } }), `${r.number} reconciled`).then(onDone);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input aria-label={`Accepted completes for ${r.number}`} className={`${smallInput} w-20`} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/[^\d]/g, ''))} />
      {short && <input aria-label={`Reason for ${r.number}`} className={`${smallInput} w-48`} placeholder="Why fewer were accepted" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
      <Button size="sm" aria-label={`Reconcile ${r.number}`} disabled={n === '' || k > r.ordered || (short && !note.trim())} onClick={save}>Reconcile</Button>
    </div>
  );
}

export function Reconciliation({ write }: { write: boolean }) {
  const q = useLive<Rec[]>('/finance/reconciliation');
  return (
    <Panel>
      <PanelHeader eyebrow="Reconciliation" title="Completes ordered, recorded and accepted"
        info="Recorded is what Sampledge counted itself: usable completes on the project's surveys that came in with this vendor as the source. Accepting fewer than ordered (with a reason) lowers the open payable before it is paid, and closes the PO." />
      <Loadable q={q}>{(rows) => (
        <DataTable rows={rows} empty={<EmptyState title="No purchase orders" body="A PO is raised when a 'Purchasing sample' approval is granted." />} cols={[
          { key: 'n', label: 'PO', render: (r) => <div><div className="font-medium">{r.number}</div><div className="text-2xs text-ink-3">{r.vendorName} · {r.projectCode}</div></div> },
          { key: 'o', label: 'Ordered', align: 'right', render: (r) => fmtNum(r.ordered) },
          { key: 'r', label: 'Recorded', align: 'right', render: (r) => <span className={r.recordedCompletes < r.ordered ? 'text-ink-3' : ''}>{fmtNum(r.recordedCompletes)}</span> },
          { key: 'a', label: 'Accepted', align: 'right', render: (r) => (r.accepted === null ? '—' : <span>{fmtNum(r.accepted)}{r.variance ? <Badge tone="orange" className="ml-1.5">{r.variance}</Badge> : null}</span>) },
          { key: 'p', label: 'Payable', align: 'right', render: (r) => (r.payableAmount === null ? '—' : money(r.payableAmount, r.currency)) },
          { key: 'x', label: '', align: 'right', render: (r) => <ReconcileRow r={r} write={write} onDone={q.reload} /> },
        ]} />
      )}</Loadable>
    </Panel>
  );
}

// ---- Incentives ----------------------------------------------------------------------------------

type Member = { id: string; handle: string; brand: string; points: number; status: string };
type Entry = { id: string; kind: string; points: number; valueBase: number; status: string; note: string | null; createdBy: string; createdAt: string; panelist: { handle: string; brand: string } | null };
type Ledger = { base: string; pointValue: number; outstandingPoints: number; liability: number; thisMonth: Record<string, { points: number; value: number }>; pendingRedemptions: { count: number; points: number; value: number }; entries: Entry[] };
const kindTone = { earn: 'emerald', redeem: 'blue', adjust: 'neutral', expire: 'orange' } as const;

function PostEntry({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);
  const [who, setWho] = useState<Member | null>(null);
  const [kind, setKind] = useState<'earn' | 'redeem' | 'adjust' | 'expire'>('earn');
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { api<Member[]>(`/finance/incentives/members?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound([])); }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const n = Number(points);
  const ok = who && Number.isInteger(n) && n !== 0 && (kind === 'adjust' ? !!note.trim() : n > 0);
  const post = async () => {
    const r = await act(() => api<{ status: string }>('/finance/incentives', { method: 'POST', body: { panelistId: who!.id, kind, points: n, note: note || undefined } }),
      (x) => (x.status === 'pending_approval' ? 'Redemption sent for approval (Issuing payments)' : 'Posted'));
    if (r) { setPoints(''); setNote(''); setWho(null); onDone(); }
  };
  return (
    <Panel>
      <PanelHeader eyebrow="Post an entry" title="Points for a panel member" />
      <div className="space-y-3">
        <Field label="Panel member">
          {who ? (
            <div className="flex items-center justify-between rounded-xl bg-surface-2/40 px-3 py-2 text-[13px]"><span><span className="font-medium">{who.handle}</span> · {who.brand} · {fmtNum(who.points)} pts</span><Button size="sm" variant="ghost" onClick={() => setWho(null)}>Change</Button></div>
          ) : (
            <>
              <input className={inputCls} placeholder="Search by handle" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search panel members" />
              <div className="mt-1 max-h-40 overflow-auto rounded-xl border hairline">
                {found.map((m) => <button key={m.id} type="button" className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2/60" onClick={() => setWho(m)}>{m.handle} <span className="text-ink-3">· {m.brand} · {fmtNum(m.points)} pts</span></button>)}
                {!found.length && <div className="px-3 py-2 text-2xs text-ink-3">No matches</div>}
              </div>
            </>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entry">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Entry kind">
              <option value="earn">Earned</option><option value="redeem">Redeemed (needs approval)</option><option value="expire">Expired</option><option value="adjust">Adjustment (signed)</option>
            </select>
          </Field>
          <Field label="Points"><input className={inputCls} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(kind === 'adjust' ? /[^\d-]/g : /[^\d]/g, ''))} aria-label="Points" /></Field>
        </div>
        <Field label={kind === 'adjust' ? 'Reason (required)' : 'Note'}><input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" /></Field>
        <Button variant="primary" disabled={!ok} onClick={post}>{kind === 'redeem' ? 'Request redemption' : 'Post'}</Button>
      </div>
    </Panel>
  );
}

export function Incentives({ write }: { write: boolean }) {
  const [tick, setTick] = useState(0);
  const q = useLive<Ledger>('/finance/incentives', [tick]);
  const d = q.data;
  const c = d?.base ?? 'USD';
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Points outstanding" value={d?.outstandingPoints ?? 0} format={fmtNum} color="rgb(var(--purple))" />
        <KpiCard label="Liability" value={d?.liability ?? 0} format={(n) => money(n, c)} status={{ tone: 'ok', text: d ? `${money(d.pointValue, c, 4)} per point` : '' }} color="rgb(var(--orange))" />
        <KpiCard label="Earned this month" value={d?.thisMonth.earn?.points ?? 0} format={fmtNum} color="rgb(var(--emerald))" />
        <KpiCard label="Redemptions awaiting approval" value={d?.pendingRedemptions.count ?? 0} format={fmtNum} status={d?.pendingRedemptions.count ? { tone: 'warn', text: money(d.pendingRedemptions.value, c) } : undefined} color="rgb(var(--blue))" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {write && <PostEntry onDone={() => setTick((t) => t + 1)} />}
        <Panel className={write ? '' : 'xl:col-span-2'}>
          <PanelHeader eyebrow="Incentives ledger" title="Latest entries" info="Earned, expired and adjusted points post at once. A redemption is a pay-out, so it waits for an 'Issuing payments' approval from someone else, and its points are reserved meanwhile. No reward provider is connected: posted means recorded." />
          <Loadable q={q}>{(l) => (
            <DataTable rows={l.entries} empty={<EmptyState title="No entries yet" body="Post points earned on a project, or a redemption." />} cols={[
              { key: 'w', label: 'When', render: (e) => shortDate(e.createdAt) },
              { key: 'm', label: 'Member', render: (e) => <span>{e.panelist?.handle ?? '—'} <span className="text-2xs text-ink-3">{e.panelist?.brand}</span></span> },
              { key: 'k', label: 'Entry', render: (e) => <Badge tone={kindTone[e.kind as keyof typeof kindTone] ?? 'neutral'}>{e.kind}</Badge> },
              { key: 'p', label: 'Points', align: 'right', render: (e) => <span className="num">{e.points > 0 ? '+' : ''}{fmtNum(e.points)}</span> },
              { key: 'v', label: 'Value', align: 'right', render: (e) => money(e.valueBase, l.base) },
              { key: 's', label: 'Status', render: (e) => e.status === 'posted' ? <Badge tone="emerald" dot>Posted</Badge> : e.status === 'pending_approval' ? <Badge tone="orange" dot>Awaiting approval</Badge> : <Badge tone="danger">Rejected</Badge> },
              { key: 'n', label: 'Note', render: (e) => <span className="text-2xs text-ink-3">{e.note ?? ''} · {e.createdBy}</span> },
            ]} />
          )}</Loadable>
        </Panel>
      </div>
    </>
  );
}

// ---- Forecast vs actuals -------------------------------------------------------------------------

type FRow = { forecastRevenue: number; actualRevenue: number; forecastCost?: number; actualCost?: number };
type Forecast = { base: string; current: string; margins: boolean; months: (FRow & { month: string })[]; projects: (FRow & { id: string; code: string; name: string; stage: string; deadline: string })[]; note: string };
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function ForecastActuals() {
  const q = useLive<Forecast>('/finance/forecast');
  return (
    <Loadable q={q}>{(f) => {
      const max = Math.max(1, ...f.months.flatMap((m) => [m.forecastRevenue, m.actualRevenue]));
      const tot = (k: keyof FRow) => f.projects.reduce((s, p) => s + (p[k] ?? 0), 0);
      return (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Planned revenue (all projects)" value={tot('forecastRevenue')} format={(n) => money(n, f.base)} color="rgb(var(--blue))" />
            <KpiCard label="Invoiced revenue" value={tot('actualRevenue')} format={(n) => money(n, f.base)} color="rgb(var(--emerald))" />
            {f.margins && <KpiCard label="Planned cost" value={tot('forecastCost')} format={(n) => money(n, f.base)} color="rgb(var(--purple))" />}
            {f.margins && <KpiCard label="Ordered cost" value={tot('actualCost')} format={(n) => money(n, f.base)} color="rgb(var(--orange))" />}
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Panel>
              <PanelHeader eyebrow="By month" title="Planned vs invoiced revenue" info={f.note} />
              <div className="space-y-2" role="table" aria-label="Revenue by month">
                {f.months.map((m) => (
                  <div key={m.month} role="row" className="grid grid-cols-[56px_minmax(0,1fr)_96px] items-center gap-3 text-[12px]">
                    <span role="cell" className={m.month === f.current ? 'font-semibold' : 'text-ink-3'}>{monthLabel(m.month)}</span>
                    <div role="cell" className="space-y-1">
                      <div className="h-2 rounded-full bg-blue/70" style={{ width: `${(m.forecastRevenue / max) * 100}%` }} title={`Planned ${money(m.forecastRevenue, f.base)}`} />
                      <div className="h-2 rounded-full bg-emerald" style={{ width: `${(m.actualRevenue / max) * 100}%` }} title={`Invoiced ${money(m.actualRevenue, f.base)}`} />
                    </div>
                    <span role="cell" className="num text-right">{fmtMoney(m.actualRevenue, true, f.base)} / {fmtMoney(m.forecastRevenue, true, f.base)}</span>
                  </div>
                ))}
                <div className="flex gap-4 pt-2 text-2xs text-ink-3"><span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-full bg-blue/70" /> Planned</span><span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-full bg-emerald" /> Invoiced</span></div>
              </div>
            </Panel>
            <Panel>
              <PanelHeader eyebrow="By project" title="Plan against actuals" />
              <DataTable dense rows={f.projects} empty={<EmptyState title="No projects" />} cols={[
                { key: 'p', label: 'Project', render: (p) => <div className="max-w-[220px]"><div className="truncate font-medium" title={p.name}>{p.code} · {p.name}</div><div className="text-2xs text-ink-3">{p.stage} · due {shortDate(p.deadline)}</div></div> },
                { key: 'fr', label: 'Planned rev.', align: 'right', render: (p) => money(p.forecastRevenue, f.base) },
                { key: 'ar', label: 'Invoiced', align: 'right', render: (p) => money(p.actualRevenue, f.base) },
                ...(f.margins ? [
                  { key: 'fc', label: 'Planned cost', align: 'right' as const, render: (p: Forecast['projects'][number]) => money(p.forecastCost ?? 0, f.base) },
                  { key: 'ac', label: 'Ordered cost', align: 'right' as const, render: (p: Forecast['projects'][number]) => <span className={(p.actualCost ?? 0) > (p.forecastCost ?? 0) ? 'text-danger' : ''}>{money(p.actualCost ?? 0, f.base)}</span> },
                ] : []),
              ]} />
            </Panel>
          </div>
        </>
      );
    }}</Loadable>
  );
}

// ---- Currencies ----------------------------------------------------------------------------------

type Currencies = { base: string; pointValue: number; rates: { currency: string; rate: number; effectiveFrom: string; setBy: string; history: number }[]; clients: { id: string; name: string; currency: string }[]; vendors: { id: string; name: string; currency: string }[] };

export function CurrencySettings({ write }: { write: boolean }) {
  const [tick, setTick] = useState(0);
  const q = useLive<Currencies>('/finance/currencies', [tick]);
  const [cur, setCur] = useState('');
  const [rate, setRate] = useState('');
  const [pv, setPv] = useState('');
  const bump = () => setTick((t) => t + 1);
  const saveRate = () => act(() => api('/finance/rates', { method: 'POST', body: { currency: cur, rate: Number(rate) } }), `${cur.toUpperCase()} rate recorded`).then(() => { setCur(''); setRate(''); bump(); });
  const setParty = (kind: 'client' | 'vendor', id: string, currency: string) => act(() => api('/finance/currencies/party', { method: 'PUT', body: { kind, id, currency } }), 'Currency updated').then(bump);
  const savePv = () => act(() => api('/finance/incentives/point-value', { method: 'PUT', body: { value: Number(pv) } }), 'Point value updated').then(() => { setPv(''); bump(); });
  return (
    <Loadable q={q}>{(c) => {
      const options = [c.base, ...c.rates.map((r) => r.currency)];
      const party = (kind: 'client' | 'vendor') => (r: { id: string; name: string; currency: string }) => write
        ? <select aria-label={`Currency for ${r.name}`} className={`${smallInput} w-24`} value={r.currency} onChange={(e) => setParty(kind, r.id, e.target.value)}>{[...new Set([...options, r.currency])].map((o) => <option key={o}>{o}</option>)}</select>
        : <span>{r.currency}</span>;
      return (
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel>
            <PanelHeader eyebrow="Exchange rates" title={`Base currency: ${c.base}`} info="Rates are entered here; no market feed is connected. Each invoice and PO keeps the rate it was raised at. A party whose currency has no rate is billed in the base currency. The base is fixed once invoices or POs exist." />
            <DataTable rows={c.rates.map((r) => ({ ...r, id: r.currency }))} empty={<EmptyState title="No rates yet" body={`Everything is in ${c.base}.`} />} cols={[
              { key: 'c', label: 'Currency', render: (r) => <span className="font-medium">{r.currency}</span> },
              { key: 'r', label: `${c.base} per unit`, align: 'right', render: (r) => <span className="num">{r.rate.toFixed(4)}</span> },
              { key: 'w', label: 'Set', render: (r) => <span className="text-2xs text-ink-3">{shortDate(r.effectiveFrom)} · {r.setBy}</span> },
            ]} />
            {write && (
              <div className="mt-3 flex items-end gap-2">
                <Field label="Currency"><input className={`${smallInput} w-20 uppercase`} maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.replace(/[^a-z]/gi, ''))} aria-label="Currency code" placeholder="EUR" /></Field>
                <Field label={`${c.base} per unit`}><input className={`${smallInput} w-28`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Rate" placeholder="1.08" /></Field>
                <Button size="sm" disabled={cur.length !== 3 || !(Number(rate) > 0)} onClick={saveRate}>Record rate</Button>
              </div>
            )}
            <div className="mt-5 border-t hairline pt-4">
              <div className="text-[12.5px]">Incentive point value: <span className="num font-semibold">{money(c.pointValue, c.base, 4)}</span></div>
              {write && <div className="mt-2 flex items-center gap-2"><input className={`${smallInput} w-24`} inputMode="decimal" value={pv} onChange={(e) => setPv(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Point value" placeholder={String(c.pointValue)} /><Button size="sm" disabled={!(Number(pv) > 0)} onClick={savePv}>Set</Button></div>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Clients" title="Invoiced in" />
            <DataTable dense rows={c.clients} empty={<EmptyState title="No clients" />} cols={[{ key: 'n', label: 'Client', render: (r) => r.name }, { key: 'c', label: 'Currency', align: 'right', render: party('client') }]} />
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Vendors" title="Ordered in" />
            <DataTable dense rows={c.vendors} empty={<EmptyState title="No vendors" />} cols={[{ key: 'n', label: 'Vendor', render: (r) => r.name }, { key: 'c', label: 'Currency', align: 'right', render: party('vendor') }]} />
          </Panel>
        </div>
      );
    }}</Loadable>
  );
}

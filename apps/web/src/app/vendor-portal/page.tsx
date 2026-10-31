'use client';
import { useState } from 'react';
import { Inbox, PackageCheck, XCircle } from 'lucide-react';
import { countryByCode } from '@/lib/core';
import { api } from '@/lib/api';
import { act, fmtCpi, shortDate, useLive, type Feasibility, type Payable, type PurchaseOrder } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { DataTable, LiveOnly, Loadable } from '@/components/ui/data';

type VendorAllocation = { id: string; completes: number; cpi?: number; status: string; createdAt: string; project: { code: string; name: string; countries: string[]; audience: string; deadline: string }; vendor: { name: string } };
const fTone = { sent: 'orange', responded: 'emerald', declined: 'neutral' } as const;
const fLabel = { sent: 'Awaiting your answer', responded: 'Answered', declined: 'Declined' } as const;

function RespondForm({ f, onDone }: { f: Feasibility; onDone: () => void }) {
  const [cpi, setCpi] = useState('');
  const [capacity, setCapacity] = useState(String(f.sampleSize));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (decline: boolean) => {
    setBusy(true);
    const body = decline ? { decline: true, note: note || undefined } : { cpi: Number(cpi), capacity: Number(capacity), note: note || undefined };
    const r = await act(() => api(`/feasibility/${f.id}/respond`, { method: 'POST', body }), decline ? 'Declined. The team is notified.' : 'Answer sent. It now prices the quote as supplier-confirmed.');
    setBusy(false);
    if (r) onDone();
  };
  const valid = Number(cpi) > 0 && Number(capacity) > 0;
  return (
    <div className="mt-3 grid gap-3 rounded-xl bg-surface-2/40 p-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
      <Field label="CPI (USD)"><input className={inputCls} inputMode="decimal" value={cpi} onChange={(e) => setCpi(e.target.value)} placeholder="e.g. 4.20" aria-label="CPI in US dollars" /></Field>
      <Field label="Capacity (completes)"><input className={inputCls} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} aria-label="Capacity in completes" /></Field>
      <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Field time, quotas you can't cover…" aria-label="Note" /></Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" disabled={!valid || busy} onClick={() => send(false)}>Send answer</Button>
        <Button variant="ghost" disabled={busy} onClick={() => send(true)} aria-label="Decline this request"><XCircle size={13} /> Decline</Button>
      </div>
    </div>
  );
}

function VendorInner() {
  const role = useOS((s) => s.role);
  const isVendor = role === 'vendor';
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const inbox = useLive<Feasibility[]>('/feasibility', [tick]);
  const allocs = useLive<VendorAllocation[]>('/allocations', [tick]);
  const pos = useLive<PurchaseOrder[]>('/purchase-orders', [tick]);
  const pay = useLive<Payable[]>('/payables', [tick]);
  const waiting = inbox.data?.filter((f) => f.status === 'sent') ?? [];
  const owed = (pay.data ?? []).filter((p) => p.status !== 'paid').reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Requests awaiting answer" value={waiting.length} format={(n) => fmtNum(n)} status={{ tone: waiting.length ? 'warn' : 'ok', text: waiting.length ? 'Answer to be considered' : 'All answered' }} color="rgb(var(--orange))" />
        <KpiCard label="Allocations" value={allocs.data?.length ?? 0} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="Purchase orders" value={pos.data?.length ?? 0} format={(n) => fmtNum(n)} color="rgb(var(--purple))" />
        <KpiCard label={isVendor ? 'Owed to you' : 'Owed to vendors'} value={owed} format={(n) => fmtMoney(n, false)} color="rgb(var(--emerald))" />
      </div>

      <Panel className="mb-6">
        <PanelHeader eyebrow="Feasibility requests" title={isVendor ? 'Can you deliver this?' : 'Requests sent to vendors'} info="Vendors see the brief (audience, market, sample size, incidence, LOI) but never the client's name or competing bids." actions={<Inbox size={16} className="text-ink-3" />} />
        <Loadable q={inbox}>{(rows) => rows.length ? (
          <div className="space-y-2">
            {rows.map((f) => (
              <div key={f.id} className={cn('panel-solid p-3', f.status !== 'sent' && 'opacity-80')}>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-medium">{f.reference}</span>
                  <Badge>{f.audience}</Badge>
                  <Badge>{countryByCode[f.country]?.name ?? f.country}</Badge>
                  <span className="text-ink-3">n={fmtNum(f.sampleSize)} · IR {fmtPct(f.incidence, 0)} · LOI {f.loi} min · due {shortDate(f.dueAt)}</span>
                  {!isVendor && f.vendorName && <span className="text-ink-3">· {f.vendorName}</span>}
                  <span className="ml-auto" />
                  <Badge tone={fTone[f.status]} dot>{fLabel[f.status]}</Badge>
                  {f.status === 'responded' && f.cpi != null && <span className="num text-ink-2">{fmtCpi(f.cpi)} CPI · {fmtNum(f.capacity ?? 0)} capacity</span>}
                  {isVendor && f.status === 'sent' && <Button size="sm" variant={open === f.id ? 'ghost' : 'primary'} onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? 'Close' : 'Answer'}</Button>}
                </div>
                {f.note && <div className="mt-1 text-2xs text-ink-3">“{f.note}”</div>}
                {isVendor && open === f.id && f.status === 'sent' && <RespondForm f={f} onDone={() => { setOpen(null); setTick((t) => t + 1); }} />}
              </div>
            ))}
            {!isVendor && <p className="text-2xs text-ink-3">Only the vendor can answer its own request. Answers are supplier confirmations, so nobody can enter one on a vendor's behalf.</p>}
          </div>
        ) : <EmptyState title="No feasibility requests" body={isVendor ? 'When the team asks for your CPI and capacity, the brief lands here.' : 'Request feasibility from an opportunity in the Bidding CRM.'} />}</Loadable>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Allocations" title="Sample you are delivering" actions={<PackageCheck size={16} className="text-ink-3" />} />
          <Loadable q={allocs}>{(rows) => (
            <DataTable rows={rows} empty={<EmptyState title="No allocations" />} cols={[
              { key: 'p', label: 'Project', render: (r) => <span title={r.project.name}>{r.project.code}</span> },
              ...(isVendor ? [] : [{ key: 'v', label: 'Vendor', render: (r: VendorAllocation) => r.vendor.name }]),
              { key: 'm', label: 'Markets', render: (r) => r.project.countries.join(', ') },
              { key: 'q', label: 'Completes', align: 'right', render: (r) => fmtNum(r.completes) },
              { key: 'cpi', label: 'CPI', align: 'right', render: (r) => fmtCpi(r.cpi) },
              { key: 's', label: 'Status', render: (r) => <Badge tone={r.status === 'proposed' ? 'orange' : r.status === 'closed' ? 'neutral' : 'emerald'} dot>{r.status === 'proposed' ? 'Awaiting approval' : r.status}</Badge> },
            ]} />
          )}</Loadable>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Payments" title="Purchase orders and payment status" info="Payment status is a record kept by Sampledge finance; no payment rail is connected." />
          <Loadable q={pos}>{(rows) => (
            <DataTable rows={rows} empty={<EmptyState title="No purchase orders yet" body="A PO is raised when a sample purchase is approved." />} cols={[
              { key: 'n', label: 'PO', render: (r) => <span className="font-medium">{r.number}</span> },
              { key: 'p', label: 'Project', render: (r) => r.projectCode },
              { key: 'a', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, false) },
              { key: 'd', label: 'Issued', render: (r) => shortDate(r.issuedAt) },
              { key: 's', label: 'Payment', render: (r) => { const p = r.payables[0]; return p ? <Badge tone={p.status === 'paid' ? 'emerald' : p.status === 'pending_approval' ? 'orange' : 'blue'} dot>{p.status === 'paid' ? `Paid ${shortDate(p.paidAt)}` : p.status === 'pending_approval' ? 'Being approved' : `Due ${shortDate(p.dueAt)}`}</Badge> : '—'; } },
            ]} />
          )}</Loadable>
        </Panel>
      </div>
    </>
  );
}

export default function VendorPortalPage() {
  const role = useOS((s) => s.role);
  const name = useOS((s) => s.session?.user.name);
  return (
    <div>
      <PageHeader eyebrow="Vendor Portal" title={role === 'vendor' ? `Welcome, ${name ?? 'partner'}` : 'What suppliers see'}
        subtitle={role === 'vendor' ? 'Feasibility requests, the sample you are delivering and your payments, in one place.' : 'The supplier view, scoped per vendor. Vendor users never see clients, margins or competing bids.'}
        actions={role !== 'vendor' && <Badge tone="blue">Internal preview</Badge>} />
      <LiveOnly what="Feasibility requests, allocations and payments"><VendorInner /></LiveOnly>
    </div>
  );
}

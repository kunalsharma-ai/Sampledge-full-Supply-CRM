'use client';
import { useState } from 'react';
import { BadgeCheck, FileText, Send, Wallet } from 'lucide-react';
import { access, can } from '@/lib/core';
import { api } from '@/lib/api';
import { act, fmtCpi, shortDate, useLive, usePaged, type FinanceSummary, type Invoice, type Payable, type PurchaseOrder } from '@/lib/live';
import { useOS } from '@/lib/store';
import { fmtMoney, fmtNum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, PageHeader, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';
import { DataTable, LiveOnly, Loadable, LoadMore } from '@/components/ui/data';

const invTone = { draft: 'neutral', issued: 'blue', paid: 'emerald', void: 'danger' } as const;
const payTone = { open: 'blue', pending_approval: 'orange', paid: 'emerald' } as const;
const payLabel = { open: 'Open', pending_approval: 'Awaiting approval', paid: 'Paid (recorded)' } as const;

function FinanceInner() {
  const role = useOS((s) => s.role);
  const write = access(role, 'finance') === 'full';
  const bids = can(role, 'view:vendor_bids') || role === 'vendor';
  const [tab, setTab] = useState<'receivable' | 'payable'>(role === 'vendor' ? 'payable' : 'receivable');
  const [tick, setTick] = useState(0);
  const sum = useLive<FinanceSummary>('/finance/summary', [tick]);
  const inv = usePaged<Invoice>(role === 'vendor' ? null : '/invoices', [tick]);
  const pos = usePaged<PurchaseOrder>(bids ? '/purchase-orders' : null, [tick]);
  const pay = usePaged<Payable>(bids ? '/payables' : null, [tick]);
  const bump = () => setTick((t) => t + 1);

  const issue = (i: Invoice) => act(() => api(`/invoices/${i.id}/issue`, { method: 'POST', body: { termsDays: 30 } }), `${i.number} issued; the client is notified in the Comms Hub`).then(bump);
  const received = (i: Invoice) => act(() => api(`/invoices/${i.id}/mark-paid`, { method: 'POST' }), `${i.number} marked as received`).then(bump);
  const requestPay = (p: Payable) => act(() => api(`/payables/${p.id}/request-payment`, { method: 'POST' }), 'Payment sent for approval. Someone with approve:payments decides it.').then(bump);

  const s = sum.data;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {role !== 'vendor' && <KpiCard label="Receivable (issued)" value={s?.receivable ?? 0} format={(n) => fmtMoney(n, false)} color="rgb(var(--blue))" />}
        {role !== 'vendor' && <KpiCard label="Overdue receivable" value={s?.overdueReceivable ?? 0} format={(n) => fmtMoney(n, false)} status={{ tone: s?.overdueReceivable ? 'warn' : 'ok', text: s?.overdueReceivable ? 'Chase' : 'None overdue' }} color="rgb(var(--danger))" />}
        {role !== 'vendor' && <KpiCard label="Collected" value={s?.collected ?? 0} format={(n) => fmtMoney(n, false)} color="rgb(var(--emerald))" />}
        {role !== 'client' && <KpiCard label={role === 'vendor' ? 'Owed to you' : 'Payable to vendors'} value={s?.payable ?? 0} format={(n) => fmtMoney(n, false)} color="rgb(var(--orange))" />}
        {role !== 'client' && <KpiCard label="Paid out" value={s?.paidOut ?? 0} format={(n) => fmtMoney(n, false)} color="rgb(var(--cyan))" />}
        {role !== 'client' && <KpiCard label="Purchase orders" value={s?.purchaseOrders ?? 0} format={(n) => fmtNum(n)} status={s?.awaitingApproval ? { tone: 'warn', text: `${s.awaitingApproval} payment(s) awaiting approval` } : undefined} color="rgb(var(--purple))" />}
      </div>

      {role !== 'vendor' && role !== 'client' && bids && (
        <Segmented className="mb-4" label="Ledger" value={tab} onChange={setTab} options={[{ value: 'receivable', label: 'Client invoices' }, { value: 'payable', label: 'Vendor POs and payables' }]} />
      )}

      {tab === 'receivable' && role !== 'vendor' && (
        <Panel>
          <PanelHeader eyebrow="Accounts receivable" title="Client invoices" info="Drafts are created automatically when a project reaches the Invoice stage. Clients only see issued invoices." actions={<FileText size={16} className="text-ink-3" />} />
          <Loadable q={inv}>{(rows) => (
            <DataTable rows={rows} empty={<EmptyState title="No invoices yet" body="Move a project with delivered completes to the Invoice stage and a draft appears here." />} cols={[
              { key: 'n', label: 'Invoice', render: (r) => <span className="font-medium">{r.number}</span> },
              { key: 'c', label: 'Client', render: (r) => r.clientName ?? r.clientId },
              { key: 'p', label: 'Project', render: (r) => <span title={r.project?.name}>{r.project?.code}</span> },
              { key: 'q', label: 'Completes', align: 'right', render: (r) => fmtNum(r.completes) },
              { key: 'a', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, false) },
              { key: 'd', label: 'Due', render: (r) => shortDate(r.dueAt) },
              { key: 's', label: 'Status', render: (r) => <Badge tone={invTone[r.status]} dot>{r.status}</Badge> },
              { key: 'x', label: '', align: 'right', render: (r) => write && (r.status === 'draft' ? <Button size="sm" variant="primary" onClick={() => issue(r)}><Send size={12} /> Issue</Button> : r.status === 'issued' ? <Button size="sm" onClick={() => received(r)}><BadgeCheck size={12} /> Mark received</Button> : null) },
            ]} />
          )}</Loadable>
          <LoadMore q={inv} count={inv.data?.length} />
        </Panel>
      )}

      {(tab === 'payable' || role === 'vendor') && bids && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel>
            <PanelHeader eyebrow="Purchase orders" title={role === 'vendor' ? 'Orders placed with you' : 'Raised on approved sample purchases'} />
            <Loadable q={pos}>{(rows) => (
              <DataTable rows={rows} empty={<EmptyState title="No purchase orders" body="A PO is raised when a 'Purchasing sample' approval is granted." />} cols={[
                { key: 'n', label: 'PO', render: (r) => <span className="font-medium">{r.number}</span> },
                ...(role === 'vendor' ? [] : [{ key: 'v', label: 'Vendor', render: (r: PurchaseOrder) => r.vendorName }]),
                { key: 'p', label: 'Project', render: (r) => r.projectCode },
                { key: 'q', label: 'Completes', align: 'right', render: (r) => fmtNum(r.completes) },
                { key: 'cpi', label: 'CPI', align: 'right', render: (r) => fmtCpi(r.cpi) },
                { key: 'a', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, false) },
                { key: 'd', label: 'Issued', render: (r) => shortDate(r.issuedAt) },
              ]} />
            )}</Loadable>
            <LoadMore q={pos} count={pos.data?.length} />
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Accounts payable" title={role === 'vendor' ? 'Payments due to you' : 'Vendor payables'} info="Paying a vendor needs an 'Issuing payments' approval from someone other than the requester. No payment rail is connected: paid is a record, not a transfer." actions={<Wallet size={16} className="text-ink-3" />} />
            <Loadable q={pay}>{(rows) => (
              <DataTable rows={rows} empty={<EmptyState title="No payables" />} cols={[
                { key: 'po', label: 'PO', render: (r) => r.purchaseOrder.number },
                ...(role === 'vendor' ? [] : [{ key: 'v', label: 'Vendor', render: (r: Payable) => r.vendorName }]),
                { key: 'a', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, false) },
                { key: 'd', label: 'Due', render: (r) => shortDate(r.dueAt) },
                { key: 's', label: 'Status', render: (r) => <Badge tone={payTone[r.status]} dot>{payLabel[r.status]}</Badge> },
                { key: 'x', label: '', align: 'right', render: (r) => write && r.status === 'open' && <Button size="sm" variant="primary" onClick={() => requestPay(r)}>Request payment</Button> },
              ]} />
            )}</Loadable>
            <LoadMore q={pay} count={pay.data?.length} />
          </Panel>
        </div>
      )}
      <p className="mt-4 text-2xs text-ink-3">{s?.note ?? 'Records only. No accounting system or payment rail is connected.'}</p>
    </>
  );
}

export default function FinancePage() {
  const role = useOS((s) => s.role);
  return (
    <div>
      <PageHeader eyebrow="Finance" title={role === 'vendor' ? 'Orders and payments' : role === 'client' ? 'Your invoices' : 'Receivables, POs and payables'}
        subtitle="Invoices draft themselves at the Invoice stage, purchase orders when a sample purchase is approved. Vendor payments are approval-gated."
        actions={<Badge tone="orange">No accounting system connected</Badge>} />
      <LiveOnly what="Invoices, purchase orders and payables"><FinanceInner /></LiveOnly>
    </div>
  );
}

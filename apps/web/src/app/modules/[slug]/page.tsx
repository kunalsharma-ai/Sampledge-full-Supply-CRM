'use client';
import Link from 'next/link';
import { use } from 'react';
import { CalendarRange, CheckCircle2 } from 'lucide-react';
import { modules } from '@/lib/modules';
import { access, roles, type ModuleId } from '@/lib/core';
import { Badge, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';

const scope: Partial<Record<ModuleId, string[]>> = {
  'communications': ['Project, client and vendor threads', 'Mentions, task assignment and approval requests', 'Email integration', 'Visual communication timeline per project', 'Visibility rules: vendors never see competing bids; clients never see margins'],
  'data-processing': ['Import CSV, Excel, SPSS-compatible, JSON, Parquet', 'Validation, duplicates, missing-value analysis', 'Open-end coding with AI assist', 'Recodes, derived variables, weighting', 'Versioned datasets with audit log; no silent deletes'],
  'diy': ['Guided study setup: objective → audience → markets → n → IR → LOI', 'Country map selection and animated cost calculator', 'AI research consultant (estimates clearly separated from supplier feasibility)', 'Launch, live monitoring and report download'],
  'finance': ['Quotes, POs, vendor costs and budgets', 'Invoices, receivables, payables and reconciliation', 'Respondent incentives and multi-currency', 'Forecast vs actuals and project profitability', 'Real financial records only; no simulated transactions in production'],
  'client-portal': ['Project progress and quota status', 'Deliverables and approvals', 'Scoped data: no internal margins or supplier agreements'],
  'vendor-portal': ['Opportunities, bids, allocations', 'Delivery and quality feedback', 'Invoices and payment status', 'Scoped data: no competitor bids'],
  'integrations': ['Panel adapters (Turn2Opinion, MyFrequentRewards, MyHealthOpinions)', 'Email, storage, BI and SSO connectors', 'Webhook and API key management'],
  'admin': ['Tenants and tenant isolation tests', 'RBAC and fine-grained permissions, SSO, MFA', 'Audit trails, retention and consent records', 'Backup and recovery'],
};

export default function PlannedModule({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const m = modules.find((x) => x.id === slug);
  if (!m) return <div className="py-20 text-center text-ink-3">Unknown module. <Link href="/command-center" className="text-cyan">Back to Command Center</Link></div>;
  return (
    <div>
      <PageHeader eyebrow={`Planned · Phase ${m.phase}`} title={m.label} subtitle={m.blurb} actions={<Badge tone="purple"><CalendarRange size={11} /> Lands in Phase {m.phase}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Scope" title="What this module will do" />
          <ul className="space-y-2 text-[13px]">{(scope[m.id] ?? []).map((s) => <li key={s} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-cyan" />{s}</li>)}</ul>
          <p className="mt-4 text-2xs text-ink-3">This screen is a placeholder by design. It is navigable so the role-based structure can be reviewed, but no functionality is simulated here.</p>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Access" title="Role matrix for this module" />
          <div className="grid grid-cols-2 gap-1.5 text-[12.5px]">
            {roles.map((r) => { const a = access(r.id, m.id); return <div key={r.id} className="flex items-center justify-between rounded-lg bg-surface-2/40 px-3 py-1.5"><span>{r.label}</span><Badge tone={a === 'full' ? 'emerald' : a === 'read' ? 'blue' : a === 'scoped' ? 'orange' : 'neutral'}>{a}</Badge></div>; })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

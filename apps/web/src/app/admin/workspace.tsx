'use client';
import { useState } from 'react';
import { Archive, Building2, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { act, useLive } from '@/lib/live';
import { fmtNum } from '@/lib/utils';
import { Badge, Button, EmptyState, Field, Panel, PanelHeader, inputCls } from '@/components/ui/primitives';
import { DataTable, Loadable } from '@/components/ui/data';

type Workspace = { id: string; name: string; slug: string; createdAt: string; counts: Record<string, number> };
type Category = { category: string; label: string; min: number; what: string; days: number | null; eligibleNow: number; pending: { id: string; days: number; at: string }[] };
type Retention = { lastRun: string | null; categories: Category[] };

const COUNT_LABELS: Record<string, string> = { members: 'People', clients: 'Clients', vendors: 'Vendors', projects: 'Projects', surveys: 'Surveys', responses: 'Responses', panelists: 'Panel members', messages: 'Messages', invoices: 'Invoices', auditEntries: 'Audit entries' };
const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function WorkspaceSettings({ write }: { write: boolean }) {
  const w = useLive<Workspace>('/admin/workspace');
  const [name, setName] = useState<string | null>(null);
  const save = async () => {
    if (!name) return;
    const r = await act(() => api<{ changed: boolean }>('/admin/workspace', { method: 'PATCH', body: { name } }), (x) => (x.changed ? 'Workspace renamed' : 'No change'));
    if (r) { setName(null); w.reload(); }
  };
  return (
    <Panel>
      <PanelHeader eyebrow="Workspace" title="This workspace" info="Each workspace is a separate tenant: its records are isolated by row-level security. New workspaces are created by an operator with the tenant command (see the runbook), not from inside another workspace." />
      <Loadable q={w}>{(d) => (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Field label="Name">
              <input className={inputCls} value={name ?? d.name} disabled={!write} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Workspace name" />
            </Field>
            <div className="text-[12.5px] text-ink-3">Identifier <span className="num text-ink-2">{d.slug}</span> · created {when(d.createdAt)}</div>
            {write && <Button variant="primary" disabled={!name || name.trim().length < 2 || name === d.name} onClick={save}>Save name</Button>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {Object.entries(d.counts).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-surface-2/40 p-3"><div className="text-2xs text-ink-3">{COUNT_LABELS[k] ?? k}</div><div className="num text-lg font-semibold">{fmtNum(v)}</div></div>
            ))}
          </div>
        </div>
      )}</Loadable>
    </Panel>
  );
}

function PolicyInput({ c, write, onDone }: { c: Category; write: boolean; onDone: () => void }) {
  const [v, setV] = useState<string>(c.days === null ? '' : String(c.days));
  if (!write) return <span>{c.days === null ? 'Keep' : `${fmtNum(c.days)} days`}</span>;
  const save = async (days: number | null) => {
    await act(() => api<{ changed: boolean; approvalId?: string; wouldRemove?: number }>('/admin/retention', { method: 'PUT', body: { category: c.category, days } }),
      (r) => (r.approvalId ? `Sent for approval: ${fmtNum(r.wouldRemove ?? 0)} record(s) would be removed at the next run` : r.changed ? 'Policy updated' : 'No change'));
    onDone();
  };
  const n = Number(v);
  const valid = v === '' || (Number.isInteger(n) && n >= c.min && n <= 3650);
  return (
    <div className="flex items-center gap-2">
      <input aria-label={`Days to keep ${c.label}`} className={`${inputCls.replace('w-full', '')} h-8 w-24`} inputMode="numeric" placeholder="Keep" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))} />
      <span className="text-2xs text-ink-3">days</span>
      <Button size="sm" aria-label={`Save ${c.label}`} disabled={!valid || (v === '' ? c.days === null : n === c.days) || c.pending.length > 0} onClick={() => save(v === '' ? null : n)}>Save</Button>
    </div>
  );
}

export function DataRetention({ write }: { write: boolean }) {
  const r = useLive<Retention>('/admin/retention');
  const run = async () => {
    await act(() => api<{ counts: Record<string, number> }>('/admin/retention/run', { method: 'POST' }), (x) => {
      const n = Object.values(x.counts).reduce((a, b) => a + b, 0);
      return n ? `${fmtNum(n)} record(s) removed or redacted` : 'Nothing was due';
    });
    r.reload();
  };
  return (
    <Panel>
      <PanelHeader eyebrow="Data retention" title="How long operational records are kept"
        info="Empty means keep. Turning a policy on or shortening it removes data for good, so it waits for a Deleting records approval from someone else (AI Automation → Approvals). Lengthening or turning one off applies at once. Policies run once a day; every run is in the audit trail. Research data, finance records and the audit trail itself are kept for the life of the workspace."
        actions={write ? <Button size="sm" onClick={run}><Archive size={12} /> Run policies now</Button> : undefined} />
      <Loadable q={r}>{(d) => (
        <>
          <div className="mb-3 flex items-center gap-2 text-[12.5px] text-ink-3"><Clock size={13} /> {d.lastRun ? `Last run ${when(d.lastRun)}` : 'Not run yet'}</div>
          <DataTable rows={d.categories.map((c) => ({ ...c, id: c.category }))} empty={<EmptyState title="No categories" body="" />} cols={[
            { key: 'c', label: 'Records', render: (c) => <div className="max-w-[420px]"><div className="font-medium">{c.label}</div><div className="text-2xs text-ink-3">{c.what} Minimum {c.min} days.</div></div> },
            { key: 'p', label: 'Keep for', render: (c) => <PolicyInput key={`${c.category}:${c.days}`} c={c} write={write} onDone={r.reload} /> },
            { key: 'e', label: 'Due now', align: 'right', render: (c) => (c.days === null ? <span className="text-ink-3">—</span> : fmtNum(c.eligibleNow)) },
            { key: 's', label: '', render: (c) => c.pending.length ? <Badge tone="orange" dot>{`${c.pending[0].days} days awaiting approval`}</Badge> : c.days === null ? <Badge tone="neutral">Kept</Badge> : <Badge tone="emerald" dot>On</Badge> },
          ]} />
        </>
      )}</Loadable>
    </Panel>
  );
}

export const WorkspaceIcon = Building2;

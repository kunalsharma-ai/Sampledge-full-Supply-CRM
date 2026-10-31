'use client';
import { useState } from 'react';
import { Check, MessageSquare, X } from 'lucide-react';
import { lifecycle } from '@/lib/core';
import { api } from '@/lib/api';
import { act, messageLabel, messageTone, shortDate, useLive, type Invoice, type Message } from '@/lib/live';
import { useOS } from '@/lib/store';
import { fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Bar, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { DataTable, LiveOnly, Loadable } from '@/components/ui/data';

function ClientInner() {
  const s = useOS();
  const isClient = s.role === 'client';
  const [tick, setTick] = useState(0);
  const inv = useLive<Invoice[]>('/invoices', [tick]);
  const msgs = useLive<Message[]>('/comms/messages?take=20', [tick]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // Live mode: the API already scopes projects to the signed-in client.
  const projects = s.projects;
  const pending = s.approvals.filter((a) => a.status === 'pending');
  const inField = projects.filter((p) => p.completes > 0 && lifecycle.indexOf(p.stage) < lifecycle.indexOf('Data Processing'));
  const open = (inv.data ?? []).filter((i) => i.status === 'issued');

  const send = async () => {
    const r = await act(() => api('/comms/messages', { method: 'POST', body: { channel: 'in_app', audience: 'internal', target: 'role:project_manager', subject, body } }), 'Sent to your project team');
    if (r) { setSubject(''); setBody(''); setTick((t) => t + 1); }
  };

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Projects" value={projects.length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="In field" value={inField.length} format={(n) => fmtNum(n)} color="rgb(var(--cyan))" />
        <KpiCard label="Waiting on you" value={pending.length} format={(n) => fmtNum(n)} status={{ tone: pending.length ? 'warn' : 'ok', text: pending.length ? 'Approval needed' : 'Nothing pending' }} color="rgb(var(--orange))" />
        <KpiCard label="Open invoices" value={open.reduce((a, i) => a + i.amount, 0)} format={(n) => fmtMoney(n, false)} color="rgb(var(--purple))" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <PanelHeader eyebrow="Your projects" title="Progress and fieldwork" info="Shows progress only. Supplier costs, margins and vendor names are not shared with clients." />
          <DataTable rows={projects} empty={<EmptyState title="No projects yet" />} cols={[
            { key: 'n', label: 'Project', render: (p) => <div><div className="font-medium">{p.name}</div><div className="text-2xs text-ink-3">{p.code} · {p.countries.join(', ')}</div></div> },
            { key: 's', label: 'Stage', render: (p) => <Badge tone="blue">{p.stage}</Badge> },
            { key: 'f', label: 'Completes', className: 'w-[180px]', render: (p) => <div><div className="num mb-1 text-2xs text-ink-2">{fmtNum(p.completes)} / {fmtNum(p.target)} · {fmtPct(p.target ? p.completes / p.target : 0, 0)}</div><Bar value={p.target ? p.completes / p.target : 0} tone="cyan" /></div> },
            { key: 'd', label: 'Deadline', render: (p) => shortDate(p.deadline) },
          ]} />
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader eyebrow="Approvals" title={isClient ? 'Waiting on you' : 'Client approvals'} />
            <div className="space-y-2">
              {pending.map((a) => (
                <div key={a.id} className="panel-solid p-3 text-[12.5px]">
                  <Badge tone="orange">{a.kind}</Badge>
                  <div className="mt-1.5 font-medium">{a.title}</div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="primary" disabled={a.canDecide === false} onClick={() => s.decideApproval(a.id, 'approved')}><Check size={12} /> Approve</Button>
                    <Button size="sm" variant="ghost" disabled={a.canDecide === false} onClick={() => s.decideApproval(a.id, 'rejected')}><X size={12} /> Request changes</Button>
                  </div>
                </div>
              ))}
              {!pending.length && <EmptyState title="Nothing waiting on you" body="Survey sign-offs you need to approve appear here." />}
            </div>
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Talk to the team" title="Message your project manager" actions={<MessageSquare size={16} className="text-ink-3" />} />
            <div className="space-y-2">
              <Field label="Subject"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></Field>
              <Field label="Message"><textarea className={`${inputCls} h-20 py-2`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
              <Button variant="primary" disabled={!subject.trim() || !body.trim()} onClick={send}>Send</Button>
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Invoices" title="Billing" info="Only issued invoices are shown. Drafts stay internal until finance issues them." />
          <Loadable q={inv}>{(rows) => (
            <DataTable rows={rows} empty={<EmptyState title="No invoices" />} cols={[
              { key: 'n', label: 'Invoice', render: (r) => <span className="font-medium">{r.number}</span> },
              { key: 'p', label: 'Project', render: (r) => r.project?.code },
              { key: 'a', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, false) },
              { key: 'd', label: 'Due', render: (r) => shortDate(r.dueAt) },
              { key: 's', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'emerald' : 'blue'} dot>{r.status === 'paid' ? 'Paid' : 'Due'}</Badge> },
            ]} />
          )}</Loadable>
        </Panel>
        <Panel>
          <PanelHeader eyebrow="Correspondence" title="Messages" />
          <Loadable q={msgs}>{(rows) => (
            <DataTable dense rows={rows} empty={<EmptyState title="No messages yet" />} cols={[
              { key: 's', label: 'Subject', render: (m) => <span className="font-medium">{m.subject}</span> },
              { key: 'd', label: 'Direction', render: (m) => (m.audience === 'internal' ? 'To the team' : 'From the team') },
              { key: 'w', label: 'When', render: (m) => shortDate(m.createdAt) },
              { key: 'st', label: 'Status', render: (m) => <Badge tone={messageTone[m.status]}>{messageLabel[m.status]}</Badge> },
            ]} />
          )}</Loadable>
        </Panel>
      </div>
    </>
  );
}

export default function ClientPortalPage() {
  const role = useOS((s) => s.role);
  return (
    <div>
      <PageHeader eyebrow="Client Portal" title={role === 'client' ? 'Your research, live' : 'What clients see'}
        subtitle={role === 'client' ? 'Project progress, sign-offs, invoices and a direct line to your team.' : 'The client view, scoped per client. Clients never see supplier costs, margins or vendors.'}
        actions={role !== 'client' && <Badge tone="blue">Internal preview: all clients</Badge>} />
      <LiveOnly what="Client invoices, sign-offs and messages"><ClientInner /></LiveOnly>
    </div>
  );
}

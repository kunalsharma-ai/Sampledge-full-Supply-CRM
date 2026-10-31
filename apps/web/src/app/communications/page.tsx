'use client';
import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { clients, panels, roles, vendors } from '@/lib/core';
import { api, ApiError } from '@/lib/api';
import { act, messageLabel, messageTone, shortDate, useLive, type Message, type Template } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtNum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';
import { DataTable, LiveOnly, Loadable } from '@/components/ui/data';

type Audience = 'client' | 'vendor' | 'panel' | 'internal';
type Channel = 'email' | 'sms' | 'in_app';
type Preview = { recipients: number; label: string; needsApproval: boolean; threshold: number; adapter: string };
const channelIcon = { email: Mail, sms: Smartphone, in_app: MessageSquare };
const internalRoles = roles.filter((r) => r.id !== 'vendor' && r.id !== 'client');

function targetsFor(a: Audience): { value: string; label: string }[] {
  if (a === 'client') return clients.map((c) => ({ value: `client:${c.id}`, label: c.name }));
  if (a === 'vendor') return vendors.map((v) => ({ value: `vendor:${v.id}`, label: v.name }));
  if (a === 'panel') return panels.flatMap((p) => [{ value: `panel:${p.id}:all`, label: `${p.name}: active and dormant` }, { value: `panel:${p.id}:active`, label: `${p.name}: active only` }, { value: `panel:${p.id}:dormant`, label: `${p.name}: dormant only` }]);
  return internalRoles.map((r) => ({ value: `role:${r.id}`, label: `${r.label} team` }));
}

function Composer({ onSent }: { onSent: () => void }) {
  const role = useOS((s) => s.role);
  const external = role === 'vendor' || role === 'client';
  const [audience, setAudience] = useState<Audience>(external ? 'internal' : 'client');
  const [target, setTarget] = useState(targetsFor(external ? 'internal' : 'client')[0]?.value ?? '');
  const [channel, setChannel] = useState<Channel>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const tpl = useLive<Template[]>('/comms/templates');

  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => {
      api<Preview>(`/comms/preview?audience=${audience}&target=${encodeURIComponent(target)}`).then((p) => { setPreview(p); setPreviewErr(null); }).catch((e) => { setPreview(null); setPreviewErr(e instanceof ApiError ? e.message : 'Preview unavailable'); });
    }, 200);
    return () => clearTimeout(t);
  }, [audience, target]);

  const pickAudience = (a: Audience) => { setAudience(a); setTarget(targetsFor(a)[0]?.value ?? ''); };
  const applyTemplate = async (key: string) => {
    if (!key) return;
    try {
      const r = await api<{ channel: Channel; subject: string; body: string }>('/comms/render', { method: 'POST', body: { key, vars: {} } });
      setChannel(r.channel); setSubject(r.subject); setBody(r.body);
    } catch { /* toast not needed: templates list came from the same API */ }
  };
  const send = async () => {
    const r = await act(() => api<{ needsApproval: boolean; recipients: number; adapter?: string }>('/comms/messages', { method: 'POST', body: { channel, audience, target, subject, body } }),
      (x) => (x.needsApproval ? `${fmtNum(x.recipients)} recipients: sent for approval before anything is queued` : `Queued. Delivery: ${x.adapter ?? 'see the delivery log'}.`));
    if (r) { setSubject(''); setBody(''); onSent(); }
  };

  return (
    <Panel>
      <PanelHeader eyebrow="Compose" title={external ? 'Message the Sampledge team' : 'New message'} />
      <div className="space-y-3">
        {!external && <Segmented label="Audience" value={audience} onChange={pickAudience} options={[{ value: 'client', label: 'Client' }, { value: 'vendor', label: 'Vendor' }, { value: 'panel', label: 'Panel' }, { value: 'internal', label: 'Team' }]} />}
        <Field label="To">
          <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Recipient">
            {targetsFor(audience).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel">
            <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as Channel)} aria-label="Channel">
              <option value="email">Email</option><option value="sms">SMS</option><option value="in_app">In-app</option>
            </select>
          </Field>
          {!external && (
            <Field label="Template">
              <select className={inputCls} defaultValue="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Template">
                <option value="">None</option>
                {(tpl.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Subject"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></Field>
        <Field label="Message" hint={audience === 'panel' ? 'Placeholders such as {{handle}} are stored as written. Panel members are e-mailed by the panel’s own site, so these are recorded here, not sent.' : undefined}><textarea className={`${inputCls} h-28 py-2`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} /></Field>

        <div className={cn('rounded-xl p-3 text-[12.5px]', preview?.needsApproval ? 'bg-orange/10' : 'bg-surface-2/40')} aria-live="polite">
          {preview ? (
            <div className="flex items-start gap-2">
              {preview.needsApproval ? <ShieldCheck size={15} className="mt-0.5 text-orange" /> : <Users size={15} className="mt-0.5 text-ink-3" />}
              <div>
                <div><span className="num font-semibold">{fmtNum(preview.recipients)}</span> recipient{preview.recipients === 1 ? '' : 's'} · {preview.label}</div>
                <div className="text-2xs text-ink-3">{preview.needsApproval ? `Above ${fmtNum(preview.threshold)} recipients, a 'High-volume communications' approval is required before anything is queued.` : `Delivery: ${preview.adapter}.`}</div>
              </div>
            </div>
          ) : <span className="text-ink-3">{previewErr ?? 'Counting recipients…'}</span>}
        </div>
        <Button variant="primary" disabled={!subject.trim() || !body.trim() || !preview?.recipients} onClick={send}>{preview?.needsApproval ? 'Request approval to send' : 'Send'}</Button>
      </div>
    </Panel>
  );
}

function CommsInner() {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<'all' | Message['status']>('all');
  const msgs = useLive<Message[]>('/comms/messages?take=200', [tick]);
  const rows = useMemo(() => (msgs.data ?? []).filter((m) => filter === 'all' || m.status === filter), [msgs.data, filter]);
  const count = (st: Message['status']) => (msgs.data ?? []).filter((m) => m.status === st).length;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Messages (latest 200)" value={msgs.data?.length ?? 0} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
        <KpiCard label="Sent or recorded" value={count('sent') + count('delivered_dev')} format={(n) => fmtNum(n)} color="rgb(var(--emerald))" />
        <KpiCard label="Awaiting approval" value={count('pending_approval')} format={(n) => fmtNum(n)} status={{ tone: count('pending_approval') ? 'warn' : 'ok', text: 'High-volume gate' }} color="rgb(var(--orange))" />
        <KpiCard label="Recipients reached" value={(msgs.data ?? []).filter((m) => m.status === 'delivered_dev' || m.status === 'sent').reduce((s, m) => s + m.recipients, 0)} format={(n) => fmtNum(n)} color="rgb(var(--cyan))" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Composer onSent={() => setTick((t) => t + 1)} />
        <Panel>
          <PanelHeader eyebrow="Delivery log" title="Every outbound message" info="Workflows (POs, quotes, invoices, feasibility) write here too. Panel sends skip members who withdrew marketing consent." actions={
            <select className={`${inputCls} h-8 w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {(Object.keys(messageLabel) as Message['status'][]).map((k) => <option key={k} value={k}>{messageLabel[k]}</option>)}
            </select>
          } />
          <Loadable q={msgs}>{() => (
            <DataTable dense rows={rows} empty={<EmptyState title="No messages" body="Send one, or run a workflow that notifies a client or vendor." />} cols={[
              { key: 'c', label: '', render: (m) => { const I = channelIcon[m.channel]; return <I size={14} className="text-ink-3" aria-label={m.channel} />; } },
              { key: 's', label: 'Subject', render: (m) => <div className="max-w-[320px]"><div className="truncate font-medium" title={m.subject}>{m.subject}</div><div className="truncate text-2xs text-ink-3" title={m.body}>{m.body}</div></div> },
              { key: 't', label: 'To', render: (m) => <span className="text-ink-2">{m.toRef}</span> },
              { key: 'r', label: 'Recipients', align: 'right', render: (m) => fmtNum(m.recipients) },
              { key: 'b', label: 'By', render: (m) => <span className="text-ink-3">{m.createdBy}</span> },
              { key: 'w', label: 'Created', render: (m) => shortDate(m.createdAt) },
              { key: 'st', label: 'Status', render: (m) => <span title={m.error ?? m.adapter ?? undefined}><Badge tone={messageTone[m.status]} dot>{messageLabel[m.status]}</Badge></span> },
            ]} />
          )}</Loadable>
        </Panel>
      </div>
    </>
  );
}

function AdapterBadge() {
  const a = useLive<{ mode: 'development' | 'smtp'; name: string }>('/comms/adapter');
  if (a.data?.mode === 'smtp') return <Badge tone="emerald">E-mail sends via {a.data.name}</Badge>;
  return <Badge tone="orange">Development adapter: recorded, not sent</Badge>;
}

export default function CommsPage() {
  return (
    <div>
      <PageHeader eyebrow="Comms Hub" title="Outbound communications" subtitle="Client, vendor, panel and team messages with templates, consent filtering and an approval gate for high-volume sends."
        actions={<AdapterBadge />} />
      <LiveOnly what="Messages and delivery records"><CommsInner /></LiveOnly>
    </div>
  );
}

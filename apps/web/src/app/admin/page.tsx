'use client';
import { useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, LogOut, ScrollText, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import { access, moduleAccess, roles, type ModuleId, type Role } from '@/lib/core';
import { api } from '@/lib/api';
import { act, shortDate, useLive, usePaged } from '@/lib/live';
import { modules } from '@/lib/modules';
import { useOS } from '@/lib/store';
import { fmtNum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, PageHeader, Panel, PanelHeader, SearchInput, Segmented, inputCls } from '@/components/ui/primitives';
import { DataTable, LiveOnly, Loadable, LoadMore } from '@/components/ui/data';

type Member = { id: string; name: string; email: string; role: Role; vendorId: string | null; clientId: string | null; mfaEnabled: boolean; joinedAt: string; activeSessions: number; lastSignIn: string | null; you: boolean };
type Security = { rowLevelSecurity: { enforced: boolean; databaseRole: string; roleBypassesRls: boolean; tenantSeenByDatabase: string; tablesWithTenantColumn: number; tablesWithForcedPolicies: number; note: string | null }; activeSessions: number };
type AuditRow = { id: string; actor: string; action: string; entity: string; entityId: string; before: unknown; after: unknown; at: string };
type Facets = { entities: { value: string; count: number }[]; actions: { value: string; count: number }[] };

const ASSIGNABLE: Role[] = ['platform_admin', 'executive', 'project_manager', 'survey_programmer', 'bizdev', 'data_processing', 'finance', 'panel_manager'];
const selectCls = inputCls.replace('w-full', '');
const roleLabel = (r: Role) => roles.find((x) => x.id === r)?.label ?? r;
const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const brief = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
};

function Overview({ users }: { users: Member[] | null }) {
  const sec = useLive<Security>('/admin/security');
  const sso = useLive<{ enabled: boolean; label: string | null }>('/auth/sso/config');
  const r = sec.data?.rowLevelSecurity;
  const mfa = users ? users.filter((u) => u.mfaEnabled).length : 0;
  const checks = [
    { ok: !!r?.enforced, title: 'Row-level security enforced', body: r ? `${r.tablesWithForcedPolicies} of ${r.tablesWithTenantColumn} tenant tables have forced policies. ${r.tenantSeenByDatabase === 'matches your tenant' ? 'The database is scoped to this workspace.' : 'The database is not scoped to this workspace on this request.'}` : 'Checking…' },
    { ok: r ? !r.roleBypassesRls : false, title: 'API runs as an ordinary database role', body: r ? (r.note ?? `Connected as "${r.databaseRole}", which cannot bypass the policies.`) : 'Checking…' },
    { ok: !!sso.data?.enabled, title: 'Single sign-on', body: sso.data?.enabled ? `On: ${sso.data.label}.` : 'Off. People sign in with a password and optional authenticator code. Set the OIDC_ variables to turn it on.' },
    { ok: users ? mfa === users.length : false, title: 'Two-step sign-in', body: users ? `${mfa} of ${users.length} people use an authenticator app.` : 'Checking…' },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Panel>
        <PanelHeader eyebrow="Security posture" title="Checked live against the database" info="These figures come from Postgres itself (pg_class, pg_roles, current_setting) on this request's connection, not from configuration." />
        <Loadable q={sec}>{() => (
          <ul className="space-y-3">
            {checks.map((c) => (
              <li key={c.title} className="flex gap-3 rounded-xl bg-surface-2/40 px-4 py-3">
                {c.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald" /> : <ShieldAlert size={18} className="mt-0.5 shrink-0 text-orange" />}
                <div><div className="text-[13px] font-medium">{c.title}</div><div className="text-2xs text-ink-3">{c.body}</div></div>
              </li>
            ))}
          </ul>
        )}</Loadable>
      </Panel>
      <Panel>
        <PanelHeader eyebrow="Operations" title="Backups, retention and keys" />
        <ul className="space-y-2.5 text-[13px] text-ink-2">
          <li><span className="font-medium text-ink">Backup and restore:</span> scripts/backup.sh and scripts/restore.sh, run by the operations role. See the runbook.</li>
          <li><span className="font-medium text-ink">Audit trail:</span> append-only, kept with the workspace. Every role change and sign-out below is recorded there.</li>
          <li><span className="font-medium text-ink">Consent records:</span> panelist consent history lives in Panels; deletion goes through an approval.</li>
          <li><span className="font-medium text-ink">Secrets:</span> session signing, SSO and AI keys are server environment variables and never reach the browser.</li>
        </ul>
      </Panel>
    </div>
  );
}

function People({ q, write }: { q: ReturnType<typeof useLive<Member[]>>; write: boolean }) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const setRole = async (u: Member, role: Role) => {
    setBusy(u.id);
    await act(() => api<{ approvalId?: string }>(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role } }), (r) => r.approvalId ? `Request sent: someone else approves ${u.name} as Platform Admin in AI Automation → Approvals` : `${u.name} is now ${roleLabel(role)}`);
    setBusy(null); q.reload();
  };
  const signOut = async (u: Member) => {
    setBusy(u.id);
    await act(() => api<{ revoked: number }>(`/admin/users/${u.id}/sessions/revoke`, { method: 'POST' }), (r) => `${u.name} signed out of ${r.revoked} session${r.revoked === 1 ? '' : 's'}`);
    setBusy(null); q.reload();
  };
  return (
    <Panel>
      <PanelHeader eyebrow="People and roles" title="Who can sign in to this workspace"
        info="Role changes apply on the person's next request. Making someone a Platform Admin needs an approval from another admin or an executive. Vendor and client accounts are tied to their vendor or client record, so their role is fixed here."
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Search people…" className="w-56" />} />
      <Loadable q={q}>{(rows) => {
        const list = rows.filter((u) => `${u.name} ${u.email} ${roleLabel(u.role)}`.toLowerCase().includes(search.toLowerCase()));
        return (
          <DataTable rows={list} empty={<EmptyState title="Nobody matches" body="Try a name, e-mail or role." />} cols={[
            { key: 'n', label: 'Person', render: (u) => <div><div className="font-medium">{u.name}{u.you && <Badge tone="blue" className="ml-2">You</Badge>}</div><div className="text-2xs text-ink-3">{u.email}</div></div> },
            { key: 'r', label: 'Role', render: (u) => write && !u.you && u.role !== 'vendor' && u.role !== 'client'
              ? <select aria-label={`Role for ${u.name}`} className={`${selectCls} h-8 w-44`} value={u.role} disabled={busy === u.id} onChange={(e) => setRole(u, e.target.value as Role)}>{ASSIGNABLE.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select>
              : <span>{roleLabel(u.role)}{(u.vendorId || u.clientId) && <span className="text-2xs text-ink-3"> · {u.vendorId ?? u.clientId}</span>}</span> },
            { key: 'm', label: 'Two-step', render: (u) => u.mfaEnabled ? <Badge tone="emerald" dot>On</Badge> : <Badge tone="neutral">Off</Badge> },
            { key: 's', label: 'Active sessions', align: 'right', render: (u) => fmtNum(u.activeSessions) },
            { key: 'l', label: 'Last sign-in', render: (u) => (u.lastSignIn ? when(u.lastSignIn) : 'Never') },
            { key: 'x', label: '', align: 'right', render: (u) => write && !u.you && u.activeSessions > 0 && <Button size="sm" disabled={busy === u.id} onClick={() => signOut(u)}><LogOut size={12} /> Sign out everywhere</Button> },
          ]} />
        );
      }}</Loadable>
    </Panel>
  );
}

function Audit() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const facets = useLive<Facets>('/admin/audit/facets');
  const qs = new URLSearchParams({ take: '100', ...(entity ? { entity } : {}), ...(action ? { action } : {}), ...(actor ? { actor } : {}) }).toString();
  const rows = usePaged<AuditRow>(`/audit?${qs}`, [qs]);
  return (
    <Panel>
      <PanelHeader eyebrow="Audit trail" title="Every recorded change, newest first" info="Entries are written in the same transaction as the change they describe and are never edited. Showing 100 at a time, newest first." />
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Filter by record type" className={`${selectCls} w-48`} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All record types</option>{facets.data?.entities.map((f) => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}
        </select>
        <select aria-label="Filter by action" className={`${selectCls} w-56`} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>{facets.data?.actions.map((f) => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}
        </select>
        <SearchInput value={actor} onChange={setActor} placeholder="Who made the change…" className="w-56" />
      </div>
      <Loadable q={rows}>{(list) => (
        <DataTable dense rows={list} empty={<EmptyState title="No entries match" body="Clear a filter to see more." />} cols={[
          { key: 't', label: 'When', render: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.at)}</span> },
          { key: 'a', label: 'Who', render: (r) => r.actor },
          { key: 'x', label: 'Action', render: (r) => <span className="font-mono text-[12px]">{r.action}</span> },
          { key: 'e', label: 'Record', render: (r) => <span>{r.entity} <span className="text-2xs text-ink-3">{r.entityId}</span></span> },
          { key: 'c', label: 'Change', render: (r) => <span className="block max-w-[420px] truncate font-mono text-[11px] text-ink-3" title={JSON.stringify({ before: r.before, after: r.after })}>{r.before !== null && r.before !== undefined ? `${brief(r.before)} → ` : ''}{brief(r.after)}</span> },
        ]} />
      )}</Loadable>
      <LoadMore q={rows} count={rows.data?.length} noun="entries" />
    </Panel>
  );
}

function RoleMatrix() {
  const tone = { full: 'emerald', read: 'blue', scoped: 'orange', none: 'neutral' } as const;
  const shown = modules.filter((m) => m.id in moduleAccess);
  return (
    <Panel>
      <PanelHeader eyebrow="Role matrix" title="What each role can open" info="The same matrix drives the navigation and the API guards: none returns 403 and read refuses writes. Scoped means only the records the person is party to." />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[12px]">
          <thead><tr className="text-left text-2xs uppercase tracking-wider text-ink-3"><th className="py-2 pr-3">Module</th>{roles.map((r) => <th key={r.id} className="px-1 py-2 font-medium">{r.label}</th>)}</tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} className="border-t hairline">
                <td className="py-1.5 pr-3 font-medium">{m.label}</td>
                {roles.map((r) => { const a = access(r.id, m.id as ModuleId); return <td key={r.id} className="px-1 py-1.5"><Badge tone={tone[a]}>{a === 'none' ? '—' : a}</Badge></td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AdminInner() {
  const role = useOS((s) => s.role);
  const write = access(role, 'admin') === 'full';
  const [tab, setTab] = useState<'overview' | 'people' | 'audit' | 'roles'>('overview');
  const users = useLive<Member[]>('/admin/users');
  const stats = useMemo(() => {
    const u = users.data ?? [];
    return { people: u.length, admins: u.filter((x) => x.role === 'platform_admin').length, sessions: u.reduce((a, x) => a + x.activeSessions, 0), mfa: u.filter((x) => x.mfaEnabled).length, external: u.filter((x) => x.role === 'vendor' || x.role === 'client').length };
  }, [users.data]);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="People" value={stats.people} format={fmtNum} status={{ tone: 'ok', text: `${stats.external} vendor or client` }} color="rgb(var(--blue))" />
        <KpiCard label="Platform admins" value={stats.admins} format={fmtNum} color="rgb(var(--purple))" />
        <KpiCard label="Active sessions" value={stats.sessions} format={fmtNum} color="rgb(var(--cyan))" />
        <KpiCard label="Two-step sign-in" value={stats.mfa} format={fmtNum} status={{ tone: stats.mfa < stats.people ? 'warn' : 'ok', text: `of ${stats.people} people` }} color="rgb(var(--emerald))" />
      </div>
      <Segmented className="mb-4" label="Section" value={tab} onChange={setTab} options={[
        { value: 'overview', label: <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Security</span> },
        { value: 'people', label: <span className="inline-flex items-center gap-1.5"><Users size={13} /> People and roles</span> },
        { value: 'audit', label: <span className="inline-flex items-center gap-1.5"><ScrollText size={13} /> Audit trail</span> },
        { value: 'roles', label: <span className="inline-flex items-center gap-1.5"><KeyRound size={13} /> Role matrix</span> },
      ]} />
      {tab === 'overview' && <Overview users={users.data} />}
      {tab === 'people' && <People q={users} write={write} />}
      {tab === 'audit' && <Audit />}
      {tab === 'roles' && <RoleMatrix />}
    </>
  );
}

export default function AdminPage() {
  const role = useOS((s) => s.role);
  return (
    <div>
      <PageHeader eyebrow="Admin & Security" title="People, sessions and the audit trail"
        subtitle="Who can sign in and with what role, where they are signed in, and every change recorded in this workspace. Isolation figures are read from the database on each visit."
        actions={access(role, 'admin') === 'read' ? <Badge tone="blue">Read only for your role</Badge> : undefined} />
      <LiveOnly what="People, sessions and the audit trail"><AdminInner /></LiveOnly>
    </div>
  );
}

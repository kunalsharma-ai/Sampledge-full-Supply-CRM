'use client';
/**
 * Project sync with the panels and the responses imported back, plus a reach check. Sync creates or
 * updates the project on the panel only; invitations and soft launch still need an approval in the
 * panel backend card. Imported counts are the panel's own and sit beside the project's, never in it.
 */
import { useMemo, useState } from 'react';
import { RefreshCw, Send, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { access } from '@/lib/core';
import { useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Badge, Button, Field, inputCls, Panel, PanelHeader } from '@/components/ui/primitives';

type Filter = { type: string; value?: unknown };
type ProjectRow = { id: string; code: string; name: string; countries: string[]; audience: string; target: number };
type Market = { marketID: string; country: string[]; completes: number; ir: number; loi: number; quotas: { quotaID: string; label?: string; filters: Filter[]; target: number }[] };
type Preview = { connected: boolean; body: { pid: string; name: string; markets: Market[] }; unmapped: { key: string; label: string }[]; notes: string[] };
type SyncRow = { id: string; panel: string; panelName: string; projectId: string; pid: string; syncedAt: string | null; importedAt: string | null; importError: string | null; counts: Record<string, number> };
type Status = { imported: Record<string, number>; live: unknown; liveError: string | null };
type Reach = { total: number; active: number; byGender?: Record<string, number>; byAgeBand?: Record<string, number> };

const PANELS = [['t2o', 'Turn2Opinion'], ['mfr', 'MyFrequentRewards'], ['mho', 'MyHealthOpinions']] as const;
const OUTCOMES = [['complete', 'Complete', 'emerald'], ['terminate', 'Terminate', 'neutral'], ['overquota', 'Over quota', 'neutral'], ['qualityterminate', 'Quality terminate', 'danger'], ['dropout', 'Drop out', 'neutral'], ['started', 'In progress', 'blue']] as const;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Request failed');
const filterText = (f: Filter[]) => f.map((x) => `${x.type}: ${typeof x.value === 'object' ? JSON.stringify(x.value) : String(x.value)}`).join(' · ') || 'everyone in the market';
const when = (d: string | null) => (d ? new Date(d).toLocaleString() : 'never');

export function PanelSyncPanel() {
  const role = useOS((s) => s.role);
  const canWrite = access(role, 'panels') === 'full';
  const [tick, setTick] = useState(0);
  const projects = useLive<ProjectRow[]>('/panel-backend/projects', []);
  const syncs = useLive<SyncRow[]>('/panel-backend/syncs', [tick]);
  const [panel, setPanel] = useState('t2o');
  const [projectId, setProjectId] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status | string>>({});
  const [reach, setReach] = useState({ country: 'US', gender: '', ageFrom: '18', ageTo: '65', days: '90' });
  const [reachOut, setReachOut] = useState<Reach | string | null>(null);

  const project = useMemo(() => projects.data?.find((p) => p.id === projectId), [projects.data, projectId]);
  if (!projects.live) return null;

  const quotaFilters = () => {
    const outF: Record<string, Filter[]> = {};
    for (const [key, text] of Object.entries(manual)) {
      if (!text.trim()) continue;
      // "type = a, b" per line, e.g. "car_type = ev"
      outF[key] = text.split('\n').filter((l) => l.includes('=')).map((l) => { const [t, v] = l.split('='); return { type: t.trim(), value: v.split(',').map((x) => x.trim()).filter(Boolean) }; });
    }
    return outF;
  };
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); setOut(null); try { await fn(); } catch (e) { setOut(msg(e)); } finally { setBusy(null); } };
  const doPreview = () => run('preview', async () => { setPreview(await api<Preview>(`/panel-backend/${panel}/sync/${projectId}/preview`, { method: 'POST', body: { quotaFilters: quotaFilters() } })); });
  const doSync = () => run('sync', async () => {
    const r = await api<{ link: { pid: string } }>(`/panel-backend/${panel}/sync/${projectId}`, { method: 'POST', body: { quotaFilters: quotaFilters() } });
    setOut(`Synced as ${r.link.pid}. Nothing was sent to panelists; invitations still need an approval.`);
    setTick((t) => t + 1);
  });
  const doImport = (s: SyncRow) => run(`import-${s.id}`, async () => {
    const r = await api<{ received: number; more: boolean }>(`/panel-backend/${s.panel}/sync/${s.projectId}/import`, { method: 'POST' });
    setOut(`${r.received} response update(s) imported from ${s.panelName}${r.more ? '; more are waiting, import again' : ''}.`);
    setTick((t) => t + 1);
  });
  const doStatus = async (s: SyncRow) => {
    setStatus((x) => ({ ...x, [s.id]: 'Checking…' }));
    try { const r = await api<Status>(`/panel-backend/${s.panel}/sync/${s.projectId}`); setStatus((x) => ({ ...x, [s.id]: r })); } catch (e) { setStatus((x) => ({ ...x, [s.id]: msg(e) })); }
  };
  const doReach = async () => {
    setBusy('reach'); setReachOut(null);
    const filters: Filter[] = [];
    if (reach.gender) filters.push({ type: 'gender', value: [reach.gender] });
    if (reach.ageFrom || reach.ageTo) filters.push({ type: 'age', value: { gte: Number(reach.ageFrom || 0), lte: Number(reach.ageTo || 120) } });
    try {
      const r = await api<{ data: Reach }>(`/panel-backend/${panel}/reach`, { method: 'POST', body: { country: reach.country, filters, ...(reach.days && { activeWithinDays: Number(reach.days) }) } });
      setReachOut(r.data);
    } catch (e) { setReachOut(msg(e)); } finally { setBusy(null); }
  };

  return (
    <Panel className="mt-6">
      <PanelHeader eyebrow="Panel backend" title="Project sync and panel responses"
        info="Sends a Sampledge project, its markets and quotas to a panel as a draft, then imports each respondent's outcome back (respondent id, age band, gender, country and region only). Syncing never invites anyone. Tested against a local stand-in of the panel's Sampledge routes; not yet verified against the live panels."
        actions={<Badge tone="orange">Not yet verified against the panels</Badge>} />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="panel-solid p-3">
          <div className="mb-2 text-[12.5px] font-semibold">Send a project to a panel</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Panel"><select aria-label="Sync panel" className={inputCls} value={panel} onChange={(e) => { setPanel(e.target.value); setPreview(null); }}>{PANELS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
            <Field label="Project"><select aria-label="Sync project" className={inputCls} value={projectId} onChange={(e) => { setProjectId(e.target.value); setPreview(null); setManual({}); }}>
              <option value="">Choose a project</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select></Field>
          </div>
          {project && <p className="mt-1 text-2xs text-ink-3">{project.audience} · {project.countries.join(', ')} · {project.target} completes</p>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="subtle" onClick={doPreview} disabled={!projectId || !!busy}>Preview</Button>
            {canWrite && <Button size="sm" onClick={doSync} disabled={!preview || preview.unmapped.some((u) => !manual[u.key]?.includes('=')) || !!busy}><Send size={12} />Sync to panel</Button>}
          </div>

          {preview && (
            <div className="mt-3 space-y-2">
              {preview.notes.map((n) => <p key={n} className="text-2xs text-ink-2">{n}</p>)}
              {preview.unmapped.length > 0 && (
                <div className="rounded-lg border border-orange/40 p-2">
                  <div className="text-[12px] font-semibold">Quotas that need panel filters</div>
                  <p className="text-2xs text-ink-3">These quotas use survey questions the panel does not know. One filter per line, as <span className="font-mono">profile question = value, value</span>.</p>
                  {preview.unmapped.map((u) => (
                    <Field key={u.key} label={u.label}><textarea aria-label={`Filters for ${u.label}`} className={cn(inputCls, 'h-12 font-mono text-[11px]')} placeholder="e.g. company_size = 1-99" value={manual[u.key] ?? ''} onChange={(e) => setManual({ ...manual, [u.key]: e.target.value })} /></Field>
                  ))}
                </div>
              )}
              <table className="w-full text-[11.5px]">
                <thead><tr className="text-left text-2xs text-ink-3"><th className="py-1">Market</th><th>Completes</th><th>IR %</th><th>LOI</th><th>Quotas sent</th></tr></thead>
                <tbody>{preview.body.markets.map((m) => (
                  <tr key={m.marketID} className="border-t border-white/5 align-top">
                    <td className="py-1 font-mono">{m.marketID}</td><td>{m.completes}</td><td>{m.ir}</td><td>{m.loi} min</td>
                    <td>{m.quotas.length ? m.quotas.map((q) => <div key={q.quotaID}>{q.label ?? q.quotaID}: {q.target} <span className="text-ink-3">({filterText(q.filters)})</span></div>) : <span className="text-ink-3">none</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!preview.connected && <p className="text-2xs text-orange">This panel is not connected, so syncing will fail until its URL and token are set.</p>}
            </div>
          )}
          {out && <p className="mt-2 text-2xs text-ink-2">{out}</p>}
        </div>

        <div className="panel-solid p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold"><Users size={13} />Reachable panelists</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Country"><input aria-label="Reach country" className={inputCls} value={reach.country} maxLength={2} onChange={(e) => setReach({ ...reach, country: e.target.value.toUpperCase() })} /></Field>
            <Field label="Gender"><select aria-label="Reach gender" className={inputCls} value={reach.gender} onChange={(e) => setReach({ ...reach, gender: e.target.value })}><option value="">Any</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></Field>
            <Field label="Active in last (days)"><input aria-label="Reach active days" className={inputCls} value={reach.days} onChange={(e) => setReach({ ...reach, days: e.target.value })} /></Field>
            <Field label="Age from"><input aria-label="Reach age from" className={inputCls} value={reach.ageFrom} onChange={(e) => setReach({ ...reach, ageFrom: e.target.value })} /></Field>
            <Field label="Age to"><input aria-label="Reach age to" className={inputCls} value={reach.ageTo} onChange={(e) => setReach({ ...reach, ageTo: e.target.value })} /></Field>
          </div>
          <Button className="mt-2" size="sm" variant="subtle" onClick={doReach} disabled={!!busy || reach.country.length !== 2}>Check reach</Button>
          {reachOut && (typeof reachOut === 'string' ? <p className="mt-2 text-2xs text-ink-2">{reachOut}</p> : (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Reachable</div><div className="text-lg font-semibold">{reachOut.active.toLocaleString()}</div></div>
              <div className="panel-solid p-2"><div className="text-2xs text-ink-3">Matching, any status</div><div className="text-lg font-semibold">{reachOut.total.toLocaleString()}</div></div>
              {reachOut.byAgeBand && <div className="col-span-2 text-2xs text-ink-2">{Object.entries(reachOut.byAgeBand).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}
            </div>
          ))}
          <p className="mt-2 text-2xs text-ink-3">Reachable means consented to invitations, account active, and active within the days given. Counts come from the panel.</p>
        </div>
      </div>

      <div className="eyebrow mb-1 mt-4">Synced projects</div>
      {syncs.data?.length ? (
        <div className="space-y-2">{syncs.data.map((s) => {
          const st = status[s.id];
          return (
            <div key={s.id} className="panel-solid p-3 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{s.pid}</span><Badge tone="blue">{s.panelName}</Badge>
                <span className="text-2xs text-ink-3">synced {when(s.syncedAt)} · imported {when(s.importedAt)}</span>
                <span className="flex-1" />
                <Button size="sm" variant="subtle" onClick={() => doStatus(s)}>Panel status</Button>
                {canWrite && <Button size="sm" variant="subtle" onClick={() => doImport(s)} disabled={!!busy}><RefreshCw size={12} />Import responses</Button>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OUTCOMES.map(([k, label, tone]) => <Badge key={k} tone={tone}>{label} {s.counts[k] ?? 0}</Badge>)}
              </div>
              {s.importError && <p className="mt-1 text-2xs text-danger">Last import failed: {s.importError}</p>}
              {st && (typeof st === 'string' ? <p className="mt-1 text-2xs text-ink-2">{st}</p> : <LiveStatus s={st} />)}
            </div>
          );
        })}</div>
      ) : <p className="text-2xs text-ink-3">No project synced yet.</p>}
    </Panel>
  );
}

type LiveMarket = { marketID: string; status?: string; target?: number | null; counts?: Record<string, number>; incidence?: number | null; medianLoiMinutes?: number | null; quotas?: { quotaID: string; label?: string | null; target?: number | null; complete?: number }[] };

/** The panel's own live counts, as a table when it has the agreed shape, otherwise as received. */
function LiveStatus({ s }: { s: Status }) {
  if (s.liveError) return <p className="mt-1 text-2xs text-danger">Panel status unavailable: {s.liveError}</p>;
  const markets = (s.live as { markets?: LiveMarket[] } | null)?.markets;
  if (!Array.isArray(markets)) return <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/20 p-2 text-[11px]">{JSON.stringify(s.live, null, 2)}</pre>;
  return (
    <div className="mt-2">
      <div className="mb-1 text-2xs text-ink-3">Live on the panel</div>
      <table className="w-full text-[11.5px]">
        <thead><tr className="text-left text-2xs text-ink-3"><th className="py-1">Market</th><th>Status</th><th>Complete</th><th>Terminate</th><th>Quality term.</th><th>Incidence</th><th>Median LOI</th></tr></thead>
        <tbody>{markets.map((m) => (
          <tr key={m.marketID} className="border-t border-white/5">
            <td className="py-1 font-mono">{m.marketID}</td><td>{m.status ?? '–'}</td>
            <td>{m.counts?.complete ?? 0}{m.target ? ` / ${m.target}` : ''}</td><td>{m.counts?.terminate ?? 0}</td><td>{m.counts?.qualityTerminate ?? 0}</td>
            <td>{m.incidence != null ? `${Math.round(m.incidence * 100)}%` : '–'}</td><td>{m.medianLoiMinutes != null ? `${m.medianLoiMinutes} min` : '–'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

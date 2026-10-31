'use client';
/**
 * Connection to the Turn2Opinion panel backend (Turn2Opinion, MyFrequentRewards, MyHealthOpinions):
 * per-panel status, a connection check, CPI quotes, and approval-gated actions with their call log.
 * Replies are shown as the backend sends them: their format is not documented yet, so nothing is
 * mapped or summarised.
 */
import { useState } from 'react';
import { PlugZap } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { access } from '@/lib/core';
import { useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Badge, Button, Field, inputCls, Panel, PanelHeader } from '@/components/ui/primitives';

type Status = { owner: boolean; verifiedAgainstBackend: boolean; panels: { panel: string; name: string; host: string | null; connected: boolean; note: string }[] };
type Call = { id: string; panel: string; action: string; method: string; path: string; status: string; httpStatus: number | null; error: string | null; createdAt: string };
const callTone: Record<string, 'emerald' | 'orange' | 'danger' | 'neutral'> = { sent: 'emerald', not_sent: 'orange', failed: 'danger', needs_review: 'danger', queued: 'neutral', sending: 'neutral' };
const msg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Request failed');

export function PanelBackendPanel() {
  const role = useOS((s) => s.role);
  const canWrite = access(role, 'panels') === 'full';
  const [tick, setTick] = useState(0);
  const st = useLive<Status>('/panel-backend', [tick]);
  const calls = useLive<Call[]>('/panel-backend/calls?take=10', [tick]);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [cpi, setCpi] = useState({ panel: 't2o', category: '', subcategory: '', ir: '30', loi: '10', country: 'US' });
  const [cpiOut, setCpiOut] = useState<string | null>(null);
  const [act, setAct] = useState({ panel: 't2o', projectId: '', action: 'invites', body: '{}' });
  const [actOut, setActOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!st.live) return null;
  const s = st.data;
  if (s && !s.owner) return null;
  const anyConnected = !!s?.panels.some((p) => p.connected);

  const check = async (panel: string) => {
    setChecks((c) => ({ ...c, [panel]: 'Checking…' }));
    try { await api(`/panel-backend/${panel}/check`, { method: 'POST' }); setChecks((c) => ({ ...c, [panel]: 'Token accepted' })); } catch (e) { setChecks((c) => ({ ...c, [panel]: msg(e) })); }
  };
  const quote = async () => {
    setBusy(true); setCpiOut(null);
    try {
      const r = await api<{ data: unknown; message: string | null }>(`/panel-backend/${cpi.panel}/cpi`, { method: 'POST', body: { category: cpi.category, ...(cpi.subcategory && { subcategory: cpi.subcategory }), ir: Number(cpi.ir), loi: Number(cpi.loi), country: cpi.country } });
      setCpiOut(JSON.stringify(r.data, null, 2));
    } catch (e) { setCpiOut(msg(e)); } finally { setBusy(false); }
  };
  const request = async () => {
    setBusy(true); setActOut(null);
    try {
      const body = JSON.parse(act.body || '{}');
      const r = await api<{ approval: { title: string } }>(`/panel-backend/${act.panel}/projects/${encodeURIComponent(act.projectId)}/actions`, { method: 'POST', body: { action: act.action, ...(act.action !== 'cancel' && { body }) } });
      setActOut(`Approval requested: ${r.approval.title}. Nothing is sent until someone else approves it.`);
      setTick((t) => t + 1);
    } catch (e) { setActOut(e instanceof SyntaxError ? 'Body must be valid JSON' : msg(e)); } finally { setBusy(false); }
  };
  const panelSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select aria-label={label} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>{s?.panels.map((p) => <option key={p.panel} value={p.panel}>{p.name}</option>)}</select>
  );

  return (
    <Panel className="mt-6">
      <PanelHeader eyebrow="Panel backend" title="Turn2Opinion backend connection"
        info="One backend serves all three panels, told apart by host; each panel needs its own URL and app token on the API server (PANEL_T2O_URL / PANEL_T2O_TOKEN, and MFR, MHO). Built from the backend's API description and tested against a local stand-in only. Replies are shown unchanged until their format is documented."
        actions={<Badge tone={anyConnected ? 'blue' : 'orange'}>{anyConnected ? 'Configured · not yet verified' : 'Not connected'}</Badge>} />
      <div className="grid gap-3 md:grid-cols-3">
        {s?.panels.map((p) => (
          <div key={p.panel} className="panel-solid p-3 text-[12.5px]">
            <div className="flex items-center gap-2 font-semibold"><PlugZap size={13} className={p.connected ? 'text-cyan' : 'text-ink-3'} />{p.name}<span className="flex-1" /><Badge tone={p.connected ? 'blue' : 'orange'}>{p.connected ? 'Configured' : 'Not connected'}</Badge></div>
            <div className="mt-1 text-2xs text-ink-3">{p.host ?? 'No URL or app token on the server'}</div>
            {p.connected && <div className="mt-2 flex items-center gap-2"><Button size="sm" variant="subtle" onClick={() => check(p.panel)}>Check connection</Button>{checks[p.panel] && <span className={cn('text-2xs', checks[p.panel] === 'Token accepted' ? 'text-emerald' : 'text-ink-2')}>{checks[p.panel]}</span>}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="panel-solid p-3">
          <div className="mb-2 text-[12.5px] font-semibold">CPI from the panel</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Panel">{panelSelect(cpi.panel, (v) => setCpi({ ...cpi, panel: v }), 'CPI panel')}</Field>
            <Field label="Category"><input aria-label="CPI category" className={inputCls} value={cpi.category} onChange={(e) => setCpi({ ...cpi, category: e.target.value })} /></Field>
            <Field label="Subcategory"><input aria-label="CPI subcategory" className={inputCls} value={cpi.subcategory} onChange={(e) => setCpi({ ...cpi, subcategory: e.target.value })} /></Field>
            <Field label="IR %"><input aria-label="CPI incidence" className={inputCls} value={cpi.ir} onChange={(e) => setCpi({ ...cpi, ir: e.target.value })} /></Field>
            <Field label="LOI (min)"><input aria-label="CPI length" className={inputCls} value={cpi.loi} onChange={(e) => setCpi({ ...cpi, loi: e.target.value })} /></Field>
            <Field label="Country"><input aria-label="CPI country" className={inputCls} value={cpi.country} onChange={(e) => setCpi({ ...cpi, country: e.target.value })} /></Field>
          </div>
          <Button className="mt-2" size="sm" onClick={quote} disabled={busy || !cpi.category}>Ask the panel</Button>
          {cpiOut && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/20 p-2 text-[11px]">{cpiOut}</pre>}
          <p className="mt-1 text-2xs text-ink-3">Shown as the backend replies; IR is sent as entered, since the description does not say whether it expects a percentage or a fraction.</p>
        </div>

        <div className="panel-solid p-3">
          <div className="mb-2 text-[12.5px] font-semibold">Invites, soft launch, cancel <Badge tone="purple">Approval required</Badge></div>
          {canWrite ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field label="Panel">{panelSelect(act.panel, (v) => setAct({ ...act, panel: v }), 'Action panel')}</Field>
                <Field label="Panel project id"><input aria-label="Panel project id" className={inputCls} value={act.projectId} onChange={(e) => setAct({ ...act, projectId: e.target.value })} /></Field>
                <Field label="Action"><select aria-label="Panel action" className={inputCls} value={act.action} onChange={(e) => setAct({ ...act, action: e.target.value })}><option value="invites">Schedule invites</option><option value="soft-launch">Soft launch</option><option value="cancel">Cancel project</option></select></Field>
              </div>
              {act.action !== 'cancel' && <Field label="Request body (JSON, in the backend's format)"><textarea aria-label="Action body" className={cn(inputCls, 'h-20 font-mono text-[11px]')} value={act.body} onChange={(e) => setAct({ ...act, body: e.target.value })} /></Field>}
              <Button className="mt-2" size="sm" onClick={request} disabled={busy || !act.projectId}>Request approval</Button>
              {actOut && <p className="mt-2 text-2xs text-ink-2">{actOut}</p>}
            </>
          ) : <p className="text-2xs text-ink-3">Read only for your role.</p>}
          <div className="eyebrow mb-1 mt-3">Sent to the panel</div>
          {calls.data?.length ? (
            <div className="space-y-1">{calls.data.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-[11.5px]"><Badge tone={callTone[c.status] ?? 'neutral'}>{c.status.replace('_', ' ')}</Badge><span className="truncate">{c.action} · {c.panel} · {c.method} {c.path}</span><span className="ml-auto truncate text-2xs text-ink-3">{c.error ?? (c.httpStatus ? `HTTP ${c.httpStatus}` : '')}</span></div>
            ))}</div>
          ) : <p className="text-2xs text-ink-3">Nothing sent yet.</p>}
        </div>
      </div>
    </Panel>
  );
}

'use client';
/**
 * Screen 39 · API Integration Hub. A connection map with SUPPLY360 at the centre and SAMPLEON,
 * PROJEXA, ZAPX, the three panel websites and outside services around it, each line coloured by
 * health. Below: the outbound event delivery log (retry one, or all failed after confirmation) and
 * API key management. A new key's secret is shown once; revoking asks you to type the key name.
 * Integration: `GET /integrations/connections`, `GET /integrations/deliveries`, `POST /integrations/deliveries/:id/retry`,
 * `POST /integrations/keys`, `DELETE /integrations/keys/:id` (all planned); SAMPLEON signing per the S2S contract.
 * Live: the delivery log reads `GET /integrations/deliveries` and retries with `POST /integrations/deliveries/:id/retry`.
 * "Configured on the API server" lists `GET /integrations` (real state; secrets are reported
 * only as set or missing) when signed in. The map, delivery log and keys stay demo until their endpoints exist.
 */
import { Copy, KeyRound, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { KpiTile, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { loadDeliveries, loadIntegrations, retryDelivery, type LiveDelivery, type LiveIntegration } from '@/lib/supply/live';
import type { SupplyQuery } from '@/lib/supply/data';
import { ApiError } from '@/lib/api';
import { apiKeys as seedKeys, connections, deliveries as seedDel, scopes, type ApiKey, type Connection, type Delivery } from '@/lib/supply/platform';
import { brandColors, screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtNum } from '@/lib/utils';

const screen = screenBySlug('api-hub')!;
const health: Record<Connection['status'], { color: string; label: string; pill: 'active' | 'paused' | 'failed' }> = {
  healthy: { color: 'rgb(var(--emerald))', label: 'Healthy', pill: 'active' }, degraded: { color: 'rgb(var(--warn))', label: 'Degraded', pill: 'paused' }, down: { color: 'rgb(var(--danger))', label: 'Down', pill: 'failed' },
};
const nodeColor = (c: Connection) => (c.id in brandColors ? brandColors[c.id as keyof typeof brandColors].color : 'rgb(var(--ink-3))');
const TODAY = '2026-11-06';
const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(TODAY)) / 86400000);

export default function ApiHub() {
  const toast = useOS((s) => s.toast);
  const reduced = useOS((s) => s.motion === 'reduced');
  const [sel, setSel] = useState<string>('zapx');
  const [dl, setDl] = useState<Delivery[]>(seedDel);
  const [dlFilter, setDlFilter] = useState<'all' | Delivery['status']>('all');
  const [keys, setKeys] = useState<ApiKey[]>(seedKeys);
  const [retryAll, setRetryAll] = useState(false);
  const [newKey, setNewKey] = useState(false);
  const [revoke, setRevoke] = useState<ApiKey | null>(null);

  const live = useSupplyData<LiveIntegration[] | null>('hub:integrations', () => null, loadIntegrations);
  const liveDl = useSupplyData<LiveDelivery[] | null>('hub:deliveries', () => null, () => loadDeliveries());
  const c = connections.find((x) => x.id === sel)!;
  const shownDl = useMemo(() => dl.filter((d) => dlFilter === 'all' || d.status === dlFilter), [dl, dlFilter]);
  const failed = dl.filter((d) => d.status === 'failed');
  const retry = (ids: string[]) => setDl((l) => l.map((d) => (ids.includes(d.id) ? { ...d, status: 'delivered', attempts: d.attempts + 1, code: 200, ms: 180 } : d)));

  const W = 640, H = 300, cx = W / 2, cy = H / 2;
  const pos = connections.map((x, i) => { const a = (i / connections.length) * Math.PI * 2 - Math.PI / 2; return { x: cx + Math.cos(a) * 250, y: cy + Math.sin(a) * 115 }; });

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={live.source === 'live' ? 'mixed' : 'demo'} title="API integration hub" subtitle="Every system SUPPLY360 talks to, how healthy each link is, the events we send, and the keys that can call us." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Connections healthy" value={connections.filter((x) => x.status === 'healthy').length} format="int" hint={`Of ${connections.length} connected systems`} />
        <KpiTile label="Events delivered, 24h" value={connections.reduce((a, x) => a + x.events24h, 0)} format="compact" />
        <KpiTile label="Deliveries failing" value={dl.filter((d) => d.status !== 'delivered').length} format="int" good="down" hint="Failed after 5 attempts, or retrying with back-off" />
        <KpiTile label="Keys expiring in 30 days" value={keys.filter((k) => daysTo(k.expires) <= 30).length} format="int" good="down" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Panel className="p-4">
          <SectionTitle eyebrow="Connection map" title="SUPPLY360 and what it talks to" />
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label="Connection map">
            {connections.map((x, i) => (
              <line key={x.id} x1={cx} y1={cy} x2={pos[i].x} y2={pos[i].y} stroke={health[x.status].color} strokeWidth={x.id === sel ? 2.5 : 1.4} strokeOpacity={x.id === sel ? 1 : 0.55}
                strokeDasharray={x.status === 'healthy' ? '6 5' : '2 4'} aria-hidden>
                {!reduced && <animate attributeName="stroke-dashoffset" from="22" to="0" dur={x.status === 'healthy' ? '1.2s' : '3s'} repeatCount="indefinite" />}
              </line>
            ))}
            <g aria-hidden><rect x={cx - 58} y={cy - 20} width={116} height={40} rx={12} fill="rgb(var(--primary))" /><text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="rgb(var(--on-primary))">SUPPLY360</text></g>
            {connections.map((x, i) => (
              <g key={x.id} role="button" tabIndex={0} aria-pressed={x.id === sel} aria-label={`${x.name}: ${health[x.status].label}, ${x.latencyMs} ms`} className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[rgb(var(--primary))]"
                onClick={() => setSel(x.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(x.id); } }}>
                <rect x={pos[i].x - 70} y={pos[i].y - 17} width={140} height={34} rx={10} fill="rgb(var(--surface))" stroke={x.id === sel ? 'rgb(var(--ink))' : 'rgb(var(--ink-3) / .35)'} strokeWidth={x.id === sel ? 1.6 : 1} />
                <circle cx={pos[i].x - 56} cy={pos[i].y} r={5} fill={nodeColor(x)} />
                <text x={pos[i].x - 45} y={pos[i].y - 1} fontSize={10.5} fontWeight={600} fill="rgb(var(--ink))">{x.name.length > 20 ? `${x.name.slice(0, 19)}…` : x.name}</text>
                <text x={pos[i].x - 45} y={pos[i].y + 11} fontSize={9} fill="rgb(var(--ink-2))">{health[x.status].label} · {x.latencyMs} ms</text>
              </g>
            ))}
          </svg>
          <p className="mt-1 text-2xs text-ink-3">Moving dashes show traffic. Green is healthy, amber is degraded (slow or over 1% errors), red is down.</p>
        </Panel>

        <Panel className="p-4">
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: nodeColor(c) }} aria-hidden /><h2 className="font-display text-[15px] font-semibold">{c.name}</h2><StatusPill status={health[c.status].pill} label={health[c.status].label} className="ml-auto" /></div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            {[['Direction', c.direction === 'both' ? 'Both ways' : c.direction === 'in' ? 'Calls us' : 'We call it'], ['Latency p50', `${c.latencyMs} ms`], ['Events, 24h', fmtCompact(c.events24h)], ['Error rate', fmt.pct(c.errorRate)], ['Last seen', c.lastSeen]].map(([k, v]) => <div key={k} className="panel-solid p-2"><dt className="text-2xs text-ink-3">{k}</dt><dd className="num font-semibold">{v}</dd></div>)}
          </dl>
          <p className="mt-3 text-2xs text-ink-3">Auth</p><p className="text-[12px]">{c.auth}</p>
          <p className="mt-2 text-2xs text-ink-3">Endpoint</p><code className="block break-all text-[11.5px]">{c.endpoint}</code>
          {c.status !== 'healthy' && <p className="mt-3 rounded-lg bg-warn/10 px-2.5 py-2 text-[12px]">Callbacks to {c.name} are slow and some time out. Failed events are kept and can be retried below; nothing is lost.</p>}
        </Panel>
      </div>

      {liveDl.source === 'live' && liveDl.data ? <LiveDeliveries q={liveDl} /> : (
      <Panel className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b hairline p-3">
          <span className="text-[13px] font-semibold">Event deliveries</span>
          <Segmented label="Delivery status" size="sm" value={dlFilter} onChange={setDlFilter} options={[{ value: 'all', label: 'All' }, { value: 'failed', label: `Failed (${failed.length})` }, { value: 'retrying', label: 'Retrying' }, { value: 'delivered', label: 'Delivered' }]} />
          <Button size="sm" variant="ghost" className="ml-auto" disabled={!failed.length} onClick={() => setRetryAll(true)}><RotateCcw size={13} /> Retry all failed</Button>
        </div>
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <caption className="sr-only">Outbound event deliveries</caption>
            <thead className="sticky top-0 bg-surface"><tr className="text-left text-2xs text-ink-3">{['Delivery', 'When', 'Event', 'To', 'Status', 'Attempts', 'Response', ''].map((h, i) => <th key={i} scope="col" className={cn('px-3 py-2 font-semibold', (i === 5 || i === 6) && 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{shownDl.map((d) => (
              <tr key={d.id} className="border-t hairline">
                <td className="px-3 py-1.5 font-mono text-[11px]">{d.id}</td><td className="px-3 py-1.5 text-ink-3">{d.at}</td><td className="px-3 py-1.5"><code className="text-[11px]">{d.event}</code></td>
                <td className="px-3 py-1.5">{connections.find((x) => x.id === d.target)!.name}</td>
                <td className="px-3 py-1.5"><StatusPill status={d.status === 'delivered' ? 'completed' : d.status === 'retrying' ? 'pending' : 'failed'} label={d.status} /></td>
                <td className="num px-3 py-1.5 text-right">{d.attempts}</td><td className="num px-3 py-1.5 text-right text-ink-2">{d.code} · {fmtNum(d.ms)} ms</td>
                <td className="px-3 py-1.5 text-right">{d.status !== 'delivered' && <Button size="xs" variant="ghost" onClick={() => { retry([d.id]); toast(`${d.id} delivered on retry`, 'ok'); }}><RefreshCw size={11} /> Retry</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {shownDl.length === 0 && <p className="p-8 text-center text-[13px] text-ink-3">No deliveries with this status.</p>}
        </div>
      </Panel>
      )}

      {live.source === 'live' && live.data && <ServerConfig rows={live.data} />}

      <Panel className="p-4">
        <SectionTitle eyebrow="Inbound access" title="API keys" actions={<Button size="sm" onClick={() => setNewKey(true)}><Plus size={13} /> New key</Button>} />
        <ul className="divide-y divide-ink-3/15">
          {keys.map((k) => {
            const left = daysTo(k.expires);
            return (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[12.5px]">
                <KeyRound size={15} className="text-ink-3" aria-hidden />
                <div className="min-w-0 flex-1"><div className="font-medium">{k.name}</div><div className="text-2xs text-ink-3"><code>{k.prefix}…</code> · {k.owner} · last used {k.lastUsed}</div></div>
                <div className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}</div>
                <span className={cn('w-36 text-right text-2xs', left <= 30 ? 'font-semibold text-warn' : 'text-ink-3')}>{left < 0 ? 'Expired' : left <= 30 ? `Expires in ${left} days` : `Expires ${k.expires}`}</span>
                <Button size="xs" variant="ghost" onClick={() => setRevoke(k)}>Revoke</Button>
              </li>
            );
          })}
          {keys.length === 0 && <li className="py-6 text-center text-2xs text-ink-3">No keys. Nothing outside the Sampledge products can call SUPPLY360.</li>}
        </ul>
      </Panel>

      <ConfirmDialog open={retryAll} onOpenChange={setRetryAll} tone="primary" title={`Retry ${failed.length} failed deliveries?`}
        body="Each event is sent again in its original order. Receivers de-duplicate by event id, so a repeat is harmless." confirmLabel="Retry all"
        onConfirm={() => { retry(failed.map((d) => d.id)); toast(`${failed.length} deliveries sent again`, 'ok'); }} />
      <ConfirmDialog open={!!revoke} onOpenChange={(v) => !v && setRevoke(null)} title={`Revoke “${revoke?.name ?? ''}”?`} typeToConfirm={revoke?.name}
        body="Calls with this key fail straight away. This can’t be undone; you would issue a new key." confirmLabel="Revoke key"
        onConfirm={() => { if (revoke) { setKeys((l) => l.filter((x) => x.id !== revoke.id)); toast(`Revoked ${revoke.name}`, 'info'); setRevoke(null); } }} />
      <NewKeyDialog open={newKey} onOpenChange={setNewKey} onCreate={(k) => { setKeys((l) => [k, ...l]); }} />
    </div>
  );
}

function NewKeyDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; onCreate: (k: ApiKey) => void }) {
  const toast = useOS((s) => s.toast);
  const [name, setName] = useState('');
  const [sc, setSc] = useState<string[]>([]);
  const [expires, setExpires] = useState('2027-05-06');
  const [secret, setSecret] = useState<string | null>(null);
  const errs = { name: name.trim().length < 3 ? 'At least 3 characters' : null, sc: sc.length ? null : 'Choose at least one scope', expires: !expires || daysTo(expires) < 1 ? 'Must be after today' : daysTo(expires) > 366 ? 'At most one year from today' : null };
  const valid = !errs.name && !errs.sc && !errs.expires;
  const reset = () => { setName(''); setSc([]); setExpires('2027-05-06'); setSecret(null); };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent title={secret ? 'Copy the key now' : 'New API key'} description={secret ? 'This is the only time the full key is shown. Store it in your secrets manager.' : 'Keys are scoped and expire. Give the key the least access it needs.'}>
        {secret ? (
          <div className="flex items-center gap-2 rounded-xl bg-surface-2/60 p-2.5"><code className="min-w-0 flex-1 break-all text-[12px]">{secret}</code>
            <Button size="xs" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(secret).catch(() => {}); toast('Key copied', 'ok'); }}><Copy size={12} /> Copy</Button></div>
        ) : (
          <div className="space-y-3">
            <label className="block text-2xs text-ink-3">Name<input className={cn(inputCls, 'mt-1')} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!(name && errs.name)} placeholder="What will use this key?" />{name && errs.name && <span className="text-danger">{errs.name}</span>}</label>
            <fieldset><legend className="mb-1 text-2xs text-ink-3">Scopes</legend>
              <div className="grid grid-cols-2 gap-1">{scopes.map((s) => <label key={s} className="flex items-center gap-2 text-[12px]"><input type="checkbox" className="accent-[rgb(var(--primary))]" checked={sc.includes(s)} onChange={(e) => setSc((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))} /><code>{s}</code></label>)}</div>
              {errs.sc && <span className="text-2xs text-ink-3">{errs.sc}</span>}
            </fieldset>
            <label className="block text-2xs text-ink-3">Expires<input type="date" className={cn(inputCls, 'mt-1')} value={expires} onChange={(e) => setExpires(e.target.value)} aria-invalid={!!errs.expires} />{errs.expires && <span className="text-danger">{errs.expires}</span>}</label>
          </div>
        )}
        <DialogFooter>
          {secret ? <DialogClose asChild><Button size="sm" variant="primary">Done</Button></DialogClose> : <>
            <DialogClose asChild><Button size="sm" variant="ghost">Cancel</Button></DialogClose>
            <Button size="sm" variant="primary" disabled={!valid} onClick={() => {
              const rand = Array.from({ length: 32 }, () => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 57)]).join('');
              const full = `sk_demo_${rand}`;
              onCreate({ id: `k-${Date.now()}`, name: name.trim(), prefix: full.slice(0, 12), scopes: sc, created: TODAY, lastUsed: 'never', expires, owner: 'You' });
              setSecret(full);
            }}>Create key</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const stateLabel: Record<LiveIntegration['state'], { label: string; tone: 'emerald' | 'cyan' | 'warn' | 'neutral' }> = {
  connected: { label: 'Connected', tone: 'emerald' }, configured: { label: 'Configured, not used yet', tone: 'cyan' }, development: { label: 'Development mode', tone: 'warn' }, off: { label: 'Off', tone: 'neutral' }, not_built: { label: 'Not built', tone: 'neutral' },
};

/** Real configuration state from the API server, grouped as the server groups it. */
function ServerConfig({ rows }: { rows: LiveIntegration[] }) {
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <Panel className="p-4">
      <SectionTitle eyebrow="Live" title="Configured on the API server" actions={<span className="text-2xs text-ink-3">{rows.filter((r) => r.state === 'connected').length} of {rows.length} connected</span>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <section key={g} aria-label={g}>
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-3">{g}</h3>
            <ul className="space-y-2">{rows.filter((r) => r.group === g).map((r) => (
              <li key={r.id} className="rounded-xl border hairline p-2.5 text-[12px]">
                <div className="flex items-center gap-2"><span className="font-semibold">{r.name}</span><Badge tone={stateLabel[r.state].tone} className="ml-auto">{stateLabel[r.state].label}</Badge></div>
                <p className="mt-1 text-ink-2">{r.detail}</p>
                {r.settings.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{r.settings.map((x) => <code key={x.name} className={cn('rounded px-1 text-[10.5px]', x.set ? 'bg-emerald/10 text-ink' : 'bg-ink-3/10 text-ink-3')} title={x.set ? 'Set' : 'Not set'}>{x.name}{x.set ? ' ✓' : ''}</code>)}</p>}
                {r.lastActivity && <p className="mt-1 text-2xs text-ink-3">Last: {r.lastActivity.summary} · {new Date(r.lastActivity.at).toLocaleString()}</p>}
              </li>
            ))}</ul>
          </section>
        ))}
      </div>
      <p className="mt-2 text-2xs text-ink-3">Settings are environment variables on the API server. Values are never sent to the browser, only whether each one is set.</p>
    </Panel>
  );
}

const dlPill: Record<LiveDelivery['status'], 'completed' | 'pending' | 'failed' | 'paused'> = { delivered: 'completed', queued: 'paused', retrying: 'pending', failed: 'failed' };

/** The real outbox: what SUPPLY360 has sent or is trying to send, and a retry for events the worker gave up on. */
function LiveDeliveries({ q }: { q: SupplyQuery<LiveDelivery[] | null> }) {
  const toast = useOS((s) => s.toast);
  const [filter, setFilter] = useState<'all' | LiveDelivery['status']>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = q.data ?? [];
  const failed = rows.filter((d) => d.status === 'failed');
  const shown = rows.filter((d) => filter === 'all' || d.status === filter);
  const retry = async (ids: string[]) => {
    setBusy(ids.length > 1 ? 'all' : ids[0]);
    let ok = 0;
    for (const id of ids) { try { await retryDelivery(id); ok++; } catch (e) { toast(e instanceof ApiError ? e.message : 'Retry failed', 'warn'); } }
    setBusy(null);
    if (ok) toast(`${ok} event${ok > 1 ? 's' : ''} back in the queue; the worker sends ${ok > 1 ? 'them' : 'it'} on its next pass`, 'ok');
    q.reload();
  };
  return (
    <Panel className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b hairline p-3">
        <span className="text-[13px] font-semibold">Event deliveries</span><Badge tone="emerald">Live</Badge>
        <Segmented label="Delivery status" size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'failed', label: `Failed (${failed.length})` }, { value: 'retrying', label: 'Retrying' }, { value: 'queued', label: 'Queued' }, { value: 'delivered', label: 'Delivered' }]} />
        <Button size="sm" variant="ghost" onClick={q.reload}><RefreshCw size={13} /> Refresh</Button>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={!failed.length || !!busy} onClick={() => setAll(true)}><RotateCcw size={13} /> Retry all failed</Button>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <caption className="sr-only">Outbound event deliveries from the API server</caption>
          <thead className="sticky top-0 bg-surface"><tr className="text-left text-2xs text-ink-3">{['When', 'Event', 'Status', 'Attempts', 'Last error', ''].map((h, i) => <th key={i} scope="col" className={cn('px-3 py-2 font-semibold', i === 3 && 'text-right')}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((d) => (
            <tr key={d.id} className="border-t hairline">
              <td className="px-3 py-1.5 text-ink-3">{new Date(d.createdAt).toLocaleString()}</td>
              <td className="px-3 py-1.5"><code className="text-[11px]">{d.type}</code></td>
              <td className="px-3 py-1.5"><StatusPill status={dlPill[d.status]} label={d.status} /></td>
              <td className="num px-3 py-1.5 text-right">{d.attempts}</td>
              <td className="max-w-[280px] truncate px-3 py-1.5 text-ink-2" title={d.lastError ?? undefined}>{d.lastError ?? ''}</td>
              <td className="px-3 py-1.5 text-right">{d.status === 'failed' && <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => retry([d.id])}><RefreshCw size={11} /> {busy === d.id ? 'Retrying…' : 'Retry'}</Button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {shown.length === 0 && <p className="p-8 text-center text-[13px] text-ink-3">{rows.length ? 'No deliveries with this status.' : 'Nothing has been sent yet.'}</p>}
      </div>
      <p className="border-t hairline px-3 py-2 text-2xs text-ink-3">The newest 100 events. The worker tries each one 5 times; after that it waits here for a retry. Receivers ignore an event id they have already processed, so a retry never applies twice.</p>
      <ConfirmDialog open={all} onOpenChange={setAll} tone="primary" title={`Retry ${failed.length} failed deliver${failed.length > 1 ? 'ies' : 'y'}?`}
        body="They go back in the queue and the worker sends them in order. Check that the receiver is healthy first, or they will fail again." confirmLabel="Retry all" onConfirm={() => retry(failed.map((d) => d.id))} />
    </Panel>
  );
}

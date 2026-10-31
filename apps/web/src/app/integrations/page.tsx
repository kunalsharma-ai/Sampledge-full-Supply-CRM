'use client';
/**
 * Integrations: every outside system Sampledge can talk to and its real state, read from the API
 * server's settings and recent activity. Secrets are never shown, only whether each one is set.
 */
import { Bot, Building2, KeyRound, LineChart, Mail, PlugZap, Server } from 'lucide-react';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';
import { Badge, EmptyState, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';

type State = 'connected' | 'configured' | 'development' | 'off' | 'not_built';
type Row = { id: string; name: string; group: string; state: State; detail: string; settings: { name: string; set: boolean }[]; lastActivity: { at: string; summary: string } | null; doc?: string };

const STATE: Record<State, { label: string; tone: 'emerald' | 'blue' | 'orange' | 'neutral' | 'warn'; help: string }> = {
  connected: { label: 'Connected', tone: 'emerald', help: 'Configured and seen working' },
  configured: { label: 'Configured, not verified', tone: 'blue', help: 'Settings present; not yet seen working from here' },
  development: { label: 'Development stand-in', tone: 'warn', help: 'Records instead of sending' },
  off: { label: 'Not connected', tone: 'orange', help: 'Can be switched on with the listed settings' },
  not_built: { label: 'Not built', tone: 'neutral', help: 'No adapter yet' },
};
const ICON: Record<string, typeof PlugZap> = { Panels: PlugZap, AI: Bot, 'Sign-in': KeyRound, Messaging: Mail, Finance: Building2, Data: LineChart, Operations: Server };
const ORDER = ['Panels', 'AI', 'Sign-in', 'Messaging', 'Finance', 'Data', 'Operations'];

export default function IntegrationsPage() {
  const q = useLive<Row[]>('/integrations');
  const rows = q.data ?? [];
  const count = (s: State) => rows.filter((r) => r.state === s).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Platform" title="Integrations" subtitle="Every outside system Sampledge can talk to, and whether it is actually connected. Settings live on the API server; secrets are never shown here." />
      {!q.live ? (
        <Panel><EmptyState title="Connect to the live API to see integrations" body="Integration states are read from the API server's settings, so they are not available in the offline demo." /></Panel>
      ) : q.error ? (
        <Panel><EmptyState title="Integrations could not be loaded" body={String(q.error)} /></Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATE) as State[]).map((s) => <Badge key={s} tone={STATE[s].tone}>{STATE[s].label} · {count(s)}</Badge>)}
          </div>
          <Panel>
            <PanelHeader eyebrow="Supply" title={<span className="flex items-center gap-2"><PlugZap size={15} />Panels</span>} info="One backend serves all three panels; each needs its own URL and app token. See docs/integrations/TURN2OPINION.md." />
            <div className="grid gap-3 md:grid-cols-3">{rows.filter((r) => r.group === 'Panels').map((r) => <Card key={r.id} r={r} />)}</div>
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Platform" title="Other services" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ORDER.filter((g) => g !== 'Panels').flatMap((g) => rows.filter((r) => r.group === g)).map((r) => <Card key={r.id} r={r} showGroup />)}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Card({ r, showGroup }: { r: Row; showGroup?: boolean }) {
  const Icon = ICON[r.group] ?? PlugZap;
  return (
    <article className="panel-solid flex flex-col gap-2 p-3 text-[12.5px]" aria-label={r.name}>
      {showGroup && <div className="eyebrow flex items-center gap-1.5"><Icon size={12} />{r.group}</div>}
      <div className="flex items-start gap-2">
        <span className="font-semibold">{r.name}</span><span className="flex-1" />
        <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
      </div>
      <p className="text-ink-2">{r.detail}</p>
      {r.settings.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Settings">
          {r.settings.map((s) => (
            <li key={s.name} className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10.5px] ring-1 ring-inset', s.set ? 'text-emerald ring-emerald/30' : 'text-ink-3 ring-ink-3/25')}>
              {s.name} {s.set ? 'set' : 'not set'}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-2xs text-ink-3">{r.lastActivity ? `Last: ${r.lastActivity.summary}, ${new Date(r.lastActivity.at).toLocaleString()}` : STATE[r.state].help}</p>
    </article>
  );
}

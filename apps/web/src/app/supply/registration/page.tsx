'use client';
/**
 * Screen 8 · Registration & Verification. Funnel strip on top; below it a review queue with the
 * evidence for the selected sign-up shown side by side. Keyboard: j/k move, a approve, r reject.
 */
import { motion } from 'motion/react';
import { Check, ChevronRight, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Panel } from '@/components/ui/primitives';
import { Kbd } from '@/components/ui/overlay';
import { StatusPill } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum, rng } from '@/lib/utils';

const screen = screenBySlug('registration')!;
const funnel = [['Visits', 182_400], ['Sign-ups', 21_960], ['Email verified', 19_180], ['Device check passed', 17_420], ['Profile started', 14_310], ['First survey', 9_870]] as const;
const rules = [['Disposable email', 0.991], ['Device fingerprint unique', 0.962], ['IP country = claimed', 0.948], ['No VPN / proxy', 0.973], ['Velocity (sign-ups per IP)', 0.996], ['Document check (MHO)', 0.88]] as const;

type Case = { id: string; handle: string; brand: 't2o' | 'mfr' | 'mho'; country: string; ipCountry: string; at: string; score: number; signals: { label: string; ok: boolean; detail: string }[] };
function makeQueue(): Case[] {
  const r = rng(88);
  const cs = ['US', 'GB', 'DE', 'IN', 'CA', 'FR'];
  return Array.from({ length: 12 }, (_, i) => {
    const country = cs[Math.floor(r() * cs.length)];
    const mismatch = r() < 0.35;
    const vpn = r() < 0.25;
    const dupe = r() < 0.3;
    const signals = [
      { label: 'Email domain', ok: r() > 0.1, detail: r() > 0.1 ? 'Established provider, domain age 19 years' : 'Domain registered 3 days ago' },
      { label: 'Device fingerprint', ok: !dupe, detail: dupe ? 'Matches 2 existing accounts (MFR)' : 'No other account on this device' },
      { label: 'IP location', ok: !mismatch, detail: mismatch ? 'IP in NG, claimed ' + country : `IP in ${country}, matches claim` },
      { label: 'VPN / proxy', ok: !vpn, detail: vpn ? 'Commercial VPN exit node' : 'Residential connection' },
      { label: 'Form behaviour', ok: r() > 0.15, detail: r() > 0.15 ? 'Typed at human speed, 2m 14s on form' : 'Form completed in 9 seconds' },
    ];
    const bad = signals.filter((s) => !s.ok).length;
    return { id: `rg-${4100 + i}`, handle: `new-member-${(i * 53) % 900 + 100}`, brand: (['t2o', 'mfr', 'mho'] as const)[Math.floor(r() * 3)], country, ipCountry: mismatch ? 'NG' : country, at: `${1 + i * 7}m ago`, score: Math.max(0.05, 0.95 - bad * 0.22 - r() * 0.1), signals };
  });
}

export default function Registration() {
  const toast = useOS((s) => s.toast);
  const [queue, setQueue] = useState(makeQueue);
  const [sel, setSel] = useState(0);
  const [decided, setDecided] = useState({ approved: 0, rejected: 0 });
  const cur = queue[Math.min(sel, queue.length - 1)];
  const decide = (verdict: 'approved' | 'rejected') => {
    if (!cur) return;
    setQueue((q) => q.filter((c) => c.id !== cur.id));
    setDecided((d) => ({ ...d, [verdict]: d[verdict] + 1 }));
    toast(`${cur.handle} ${verdict}`, verdict === 'approved' ? 'ok' : 'warn');
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === 'j') setSel((s) => Math.min(queue.length - 1, s + 1));
      if (e.key === 'k') setSel((s) => Math.max(0, s - 1));
      if (e.key === 'a') decide('approved');
      if (e.key === 'r') decide('rejected');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const max = funnel[0][1];
  const worst = useMemo(() => [...rules].sort((a, b) => a[1] - b[1])[0], []);

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source="demo" title="Registration & verification" subtitle="Last 7 days across all three panels. Only sign-ups that fail an automatic rule reach the review queue." />

      <Panel className="p-4">
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Sign-up funnel">
          {funnel.map(([label, v], i) => (
            <li key={label} className="relative rounded-xl bg-surface-2/40 p-3">
              <div className="text-2xs text-ink-3">{label}</div>
              <div className="num font-jakarta text-lg font-bold">{fmtNum(v)}</div>
              <div className="mt-1 h-1.5 rounded-full bg-ink-3/12"><motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${Math.max(4, (v / max) * 100)}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} /></div>
              {i > 0 && <div className="mt-1 text-2xs text-ink-3">{((v / funnel[i - 1][1]) * 100).toFixed(0)}% of previous</div>}
              {i < funnel.length - 1 && <ChevronRight size={14} className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-ink-3 xl:block" aria-hidden />}
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr_260px]">
        <Panel className="p-3">
          <SectionTitle eyebrow="Review queue" title={`${queue.length} waiting`} actions={<span className="flex items-center gap-1 text-2xs text-ink-3"><Kbd>j</Kbd><Kbd>k</Kbd></span>} />
          <ul className="space-y-1" aria-label="Sign-ups to review">
            {queue.map((c, i) => (
              <li key={c.id}>
                <button onClick={() => setSel(i)} aria-current={i === sel ? 'true' : undefined} className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px]', i === sel ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-2/50')}>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', c.score < 0.4 ? 'bg-danger' : c.score < 0.7 ? 'bg-warn' : 'bg-emerald')} aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.handle}</span><span className="text-2xs text-ink-3">{c.country} · {c.at}</span></span>
                  <PanelChip panel={c.brand} short />
                </button>
              </li>
            ))}
            {queue.length === 0 && <li className="py-10 text-center text-[13px] text-ink-3">Queue clear. New cases arrive as rules flag them.</li>}
          </ul>
        </Panel>

        <Panel className="p-4">
          {cur ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1"><div className="font-display text-lg font-semibold">{cur.handle}</div><div className="text-2xs text-ink-3">{cur.id} · claimed {cur.country} · IP {cur.ipCountry}</div></div>
                <div className="text-right"><div className="text-2xs text-ink-3">Trust score</div><div className={cn('num font-jakarta text-2xl font-bold', cur.score < 0.4 ? 'text-danger' : cur.score < 0.7 ? 'text-warn' : 'text-emerald')}>{Math.round(cur.score * 100)}</div></div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <section className="panel-solid p-3"><h3 className="eyebrow mb-2">Claimed</h3>
                  <dl className="space-y-1.5 text-[12.5px]">{[['Panel', <PanelChip key="p" panel={cur.brand} />], ['Country', cur.country], ['Language', cur.country === 'DE' ? 'German' : cur.country === 'FR' ? 'French' : 'English'], ['Segment', cur.brand === 'mho' ? 'Healthcare professional' : 'Consumer']].map(([k, v]) => <div key={String(k)} className="flex justify-between"><dt className="text-ink-3">{k}</dt><dd>{v}</dd></div>)}</dl>
                </section>
                <section className="panel-solid p-3"><h3 className="eyebrow mb-2">Observed</h3>
                  <dl className="space-y-1.5 text-[12.5px]">{[['IP country', cur.ipCountry], ['Device', 'Mobile · Android 15'], ['Time on form', cur.signals[4].ok ? '2m 14s' : '9s'], ['Accounts on device', cur.signals[1].ok ? '0' : '2']].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-ink-3">{k}</dt><dd className={cn((k === 'IP country' && cur.ipCountry !== cur.country) && 'font-semibold text-danger')}>{v}</dd></div>)}</dl>
                </section>
              </div>
              <ul className="mt-3 space-y-1.5">
                {cur.signals.map((s) => (
                  <li key={s.label} className="flex items-center gap-2.5 rounded-lg bg-surface-2/30 px-3 py-2 text-[12.5px]">
                    {s.ok ? <ShieldCheck size={15} className="text-emerald" /> : <ShieldAlert size={15} className="text-danger" />}
                    <span className="w-36 font-medium">{s.label}</span><span className="flex-1 text-ink-2">{s.detail}</span>
                    <StatusPill status={s.ok ? 'approved' : 'flagged'} label={s.ok ? 'pass' : 'fail'} />
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="success" onClick={() => decide('approved')}><Check size={13} /> Approve <Kbd className="ml-1">a</Kbd></Button>
                <Button size="sm" variant="danger" onClick={() => decide('rejected')}><X size={13} /> Reject <Kbd className="ml-1">r</Kbd></Button>
                <Button size="sm" variant="ghost" onClick={() => toast('Asked for ID document (demo)', 'info')}>Request document</Button>
              </div>
            </>
          ) : <p className="py-16 text-center text-[13px] text-ink-3">Nothing to review.</p>}
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Automatic rules" title="Pass rates" />
          <ul className="space-y-2">
            {rules.map(([r, v]) => <li key={r}><div className="flex justify-between text-[12.5px]"><span className="text-ink-2">{r}</span><span className="num font-semibold">{(v * 100).toFixed(1)}%</span></div><div className="mt-1 h-1.5 rounded-full bg-ink-3/12"><div className={cn('h-full rounded-full', v < 0.9 ? 'bg-warn' : 'bg-emerald')} style={{ width: `${v * 100}%` }} /></div></li>)}
          </ul>
          <p className="mt-3 text-2xs text-ink-3">Lowest pass rate: <b className="text-ink">{worst[0]}</b>. This session: {decided.approved} approved, {decided.rejected} rejected.</p>
          <Badge tone="neutral" className="mt-2">Evidence is synthetic demo data</Badge>
        </Panel>
      </div>
    </div>
  );
}

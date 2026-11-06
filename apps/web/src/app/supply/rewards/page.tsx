'use client';
/**
 * Screen 31 · Rewards & Wallet Management. Read like a finance view: outstanding liability by
 * panel first, then the append-only points ledger (each row carries its hash and the previous
 * row's hash, and "Verify chain" re-checks the links), then reconciliation of payouts against
 * provider statements. Nothing on this screen edits a balance: corrections are new ledger rows,
 * made from the panellist's 360° page.
 * Live: the ledger lists `GET /panels/ledger` (real incentive entries, newest first). The hash chain
 * and "Verify chain" are demo-only until the ledger stores hashes. `GET /panels/reward-policy` (available).
 */
import Link from 'next/link';
import { motion } from 'motion/react';
import { CheckCircle2, Link2, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel, SearchInput, Segmented } from '@/components/ui/primitives';
import { StatusPill, type Status } from '@/components/ui/status';
import { DataTable, type Column } from '@/components/ui/table';
import { KpiTile, PanelChip, SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { loadLedger, type LiveLedgerEntry } from '@/lib/supply/live';
import { ledger, liability, POINT_USD, reconciliation, type Tx, type TxType } from '@/lib/supply/operations';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtCompact, fmtMoney, fmtNum } from '@/lib/utils';

const screen = screenBySlug('rewards')!;
const statusPill: Record<Tx['status'], Status> = { posted: 'completed', pending: 'pending', held: 'paused', failed: 'failed' };
const typeTone: Record<TxType, string> = { earn: 'text-emerald', bonus: 'text-cyan', redeem: 'text-primary', reversal: 'text-danger', expiry: 'text-ink-3', adjust: 'text-warn' };

export default function Rewards() {
  const toast = useOS((s) => s.toast);
  const [type, setType] = useState<'all' | TxType>('all');
  const [q, setQ] = useState('');
  const [verify, setVerify] = useState<'idle' | 'running' | 'ok'>('idle');
  const [investigated, setInvestigated] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(25);
  const live = useSupplyData<LiveLedgerEntry[] | null>('rewards:ledger', () => null, loadLedger);
  const isLive = live.source === 'live' && !!live.data;
  const rows = useMemo(() => ledger.filter((t) => (type === 'all' || t.type === type) && (!q || `${t.id} ${t.panellist.handle} ${t.ref}`.toLowerCase().includes(q.toLowerCase()))), [type, q]);
  const totalPts = liability.reduce((a, l) => a + l.points, 0);
  const expiring = liability.reduce((a, l) => a + l.expiring90d, 0);
  const recDiff = reconciliation.reduce((a, x) => a + Math.abs(x.ledgerUsd - x.statementUsd), 0);

  const runVerify = () => {
    setVerify('running');
    setTimeout(() => {
      const ok = ledger.every((t, i) => i === 0 || t.prev === ledger[i - 1].hash);
      setVerify(ok ? 'ok' : 'idle'); toast(ok ? `Chain verified: ${ledger.length} rows, no gaps` : 'Chain broken', ok ? 'ok' : 'warn');
    }, 900);
  };

  const cols: Column<Tx>[] = [
    { key: 'id', label: 'Transaction', sort: (t) => t.id, render: (t) => <span className="font-mono text-[11.5px]">{t.id}</span> },
    { key: 'at', label: 'When', sort: (t) => -t.minutesAgo, render: (t) => <span className="text-ink-3">{t.at}</span> },
    { key: 'who', label: 'Panellist', render: (t) => <Link href={`/supply/panellists/${t.panellist.id}`} className="inline-flex items-center gap-1.5 hover:underline"><PanelChip panel={t.panellist.brand} short /><span className="truncate">{t.panellist.handle}</span></Link> },
    { key: 'type', label: 'Type', sort: (t) => t.type, render: (t) => <span className={cn('font-semibold capitalize', typeTone[t.type])}>{t.type}</span> },
    { key: 'points', label: 'Points', align: 'right', sort: (t) => t.points, render: (t) => <span className={cn('num font-semibold', t.points < 0 ? 'text-ink-2' : 'text-ink')}>{t.points > 0 ? '+' : ''}{fmtNum(t.points)}</span> },
    { key: 'usd', label: 'Value', align: 'right', sort: (t) => t.points, render: (t) => <span className="num text-ink-3">{fmt.money(Math.abs(t.points) * POINT_USD)}</span> },
    { key: 'status', label: 'Status', sort: (t) => t.status, render: (t) => <StatusPill status={statusPill[t.status]} label={t.status} /> },
    { key: 'ref', label: 'Reference', render: (t) => <span className="text-ink-2">{t.ref}</span> },
    { key: 'hash', label: 'Hash · previous', render: (t) => <span className="font-mono text-[10.5px] text-ink-3" title={`hash ${t.hash}, previous ${t.prev}`}>{t.hash.slice(0, 6)} ← {t.prev.slice(0, 6)}</span> },
  ];

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={isLive ? 'mixed' : 'demo'} title="Rewards & wallet" subtitle="What we owe members, every points movement in order, and whether payouts match what providers say they paid."
        actions={!isLive && <Button size="sm" variant="ghost" onClick={runVerify} disabled={verify === 'running'}>{verify === 'ok' ? <ShieldCheck size={13} className="text-emerald" /> : <Link2 size={13} />} {verify === 'running' ? 'Verifying…' : verify === 'ok' ? 'Chain verified' : 'Verify chain'}</Button>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Outstanding liability" value={totalPts * POINT_USD} format="money" delta={0.022} good="down" spark={liability[0].trend.map((x, i) => x + liability[1].trend[i] + liability[2].trend[i])} hint="Unredeemed points across all panels, at 100 points = $1" />
        <KpiTile label="Expiring in 90 days" value={expiring * POINT_USD} format="money" hint="Points that expire under the 18-month inactivity policy unless members are active" />
        <KpiTile label="Redeemed, last 30 days" value={reconciliation.reduce((a, x) => a + x.ledgerUsd, 0)} format="money" delta={0.064} />
        <KpiTile label="Unreconciled" value={recDiff} format="money" good="down" hint="Absolute difference between ledger payouts and provider statements this month" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {liability.map((l, i) => {
          const share = l.points / totalPts;
          return (
            <Panel key={l.panel} className="p-4">
              <div className="flex items-center justify-between"><PanelChip panel={l.panel} /><span className="num text-2xs text-ink-3">{(share * 100).toFixed(1)}% of total</span></div>
              <div className="num mt-2 font-jakarta text-2xl font-bold">{fmtMoney(l.points * POINT_USD)}</div>
              <div className="text-2xs text-ink-3">{fmtCompact(l.points)} points · {fmtCompact(l.members)} wallets · {fmt.money((l.points * POINT_USD) / l.members)} per wallet</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-3/12"><motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${share * 100}%` }} transition={{ duration: 0.6, delay: i * 0.1 }} /></div>
              <div className="mt-2 text-2xs text-ink-3">{fmtMoney(l.expiring90d * POINT_USD)} expiring in 90 days</div>
            </Panel>
          );
        })}
      </div>

      {isLive ? <LiveLedger rows={live.data!} /> : (
      <Panel className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b hairline p-3">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Lock size={13} className="text-ink-3" /> Points ledger</span>
          <Badge tone="neutral">Append-only</Badge>
          <SearchInput value={q} onChange={setQ} placeholder="Transaction, handle or reference…" className="ml-auto w-64" />
          <Segmented label="Transaction type" size="sm" value={type} onChange={setType} options={[{ value: 'all', label: 'All' }, ...(['earn', 'bonus', 'redeem', 'reversal', 'expiry', 'adjust'] as const).map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]} />
        </div>
        <DataTable caption="Points ledger, newest first" rows={rows.slice(0, limit)} columns={cols} getId={(t) => t.id} prefKey="ledger" />
        {rows.length > limit && <div className="border-t hairline p-2 text-center"><Button size="xs" variant="ghost" onClick={() => setLimit((l) => l + 25)}>Show 25 more ({rows.length - limit} left)</Button></div>}
        <p className="px-4 py-2.5 text-2xs text-ink-3">Rows cannot be edited or deleted. To correct a balance, add an adjustment from the panellist’s 360° page; it appears here as a new row.</p>
      </Panel>
      )}

      <Panel className="p-4">
        <SectionTitle eyebrow="This month" title="Payout reconciliation" actions={<Badge tone={recDiff ? 'warn' : 'emerald'}>{recDiff ? `${fmt.money(recDiff)} to explain` : 'Balanced'}</Badge>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <caption className="sr-only">Ledger payouts against provider statements</caption>
            <thead><tr className="text-left text-2xs text-ink-3">{['Provider', 'Items', 'Ledger', 'Statement', 'Difference', ''].map((h, i) => <th key={i} scope="col" className={cn('py-1.5 font-semibold', i > 0 && i < 5 && 'text-right')}>{h}</th>)}</tr></thead>
            <tbody>{reconciliation.map((x) => {
              const d = x.statementUsd - x.ledgerUsd;
              const done = investigated.has(x.provider);
              return (
                <tr key={x.provider} className="border-t hairline align-top">
                  <th scope="row" className="py-2 text-left font-medium">{x.provider}{x.note && <span className="block text-2xs font-normal text-ink-3">{x.note}</span>}</th>
                  <td className="num py-2 text-right">{fmtNum(x.items)}</td><td className="num py-2 text-right">{fmtMoney(x.ledgerUsd, false)}</td><td className="num py-2 text-right">{fmtMoney(x.statementUsd, false)}</td>
                  <td className={cn('num py-2 text-right font-semibold', d === 0 ? 'text-emerald' : 'text-warn')}>{d === 0 ? '0' : fmt.money(d)}</td>
                  <td className="py-2 pl-3 text-right">{d === 0 ? <CheckCircle2 size={15} className="ml-auto text-emerald" aria-label="Balanced" /> : done ? <span className="text-2xs text-ink-3">Explained</span> : <Button size="xs" variant="ghost" onClick={() => { setInvestigated((s) => new Set(s).add(x.provider)); toast(`${x.provider} difference marked as explained`, 'ok'); }}><TriangleAlert size={12} /> Mark explained</Button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

const liveKind: Record<LiveLedgerEntry['kind'], { label: string; cls: string }> = {
  earn: { label: 'Earn', cls: 'text-emerald' }, redeem: { label: 'Redeem', cls: 'text-primary' }, adjust: { label: 'Adjust', cls: 'text-warn' }, expire: { label: 'Expire', cls: 'text-ink-3' },
};
const liveStatus: Record<LiveLedgerEntry['status'], { pill: Status; label: string }> = {
  posted: { pill: 'completed', label: 'posted' }, pending_approval: { pill: 'pending', label: 'awaiting approval' }, rejected: { pill: 'rejected', label: 'rejected' },
};
const brandId = (b: string) => (b === 'turn2opinion' ? 't2o' : b === 'myfrequentrewards' ? 'mfr' : b === 'myhealthopinions' ? 'mho' : null);

/** The real incentive ledger from SUPPLY360. Entries are posted in Finance; this view only reads. */
function LiveLedger({ rows }: { rows: LiveLedgerEntry[] }) {
  const [kind, setKind] = useState<'all' | LiveLedgerEntry['kind']>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);
  const shown = rows.filter((e) => (kind === 'all' || e.kind === kind) && (!q || `${e.id} ${e.panelist?.handle ?? ''} ${e.note ?? ''} ${e.projectId ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const cols: Column<LiveLedgerEntry>[] = [
    { key: 'at', label: 'When', sort: (e) => -Date.parse(e.createdAt), render: (e) => <span className="text-ink-3">{new Date(e.createdAt).toLocaleString()}</span> },
    { key: 'who', label: 'Panellist', render: (e) => e.panelist ? <Link href={`/supply/panellists/${e.panelist.id}`} className="inline-flex items-center gap-1.5 hover:underline">{brandId(e.panelist.brand) && <PanelChip panel={brandId(e.panelist.brand)!} short />}<span>{e.panelist.handle}</span></Link> : <span className="text-ink-3">Removed</span> },
    { key: 'kind', label: 'Type', sort: (e) => e.kind, render: (e) => <span className={cn('font-semibold', liveKind[e.kind].cls)}>{liveKind[e.kind].label}</span> },
    { key: 'points', label: 'Points', align: 'right', sort: (e) => e.points, render: (e) => <span className="num font-semibold">{e.points > 0 ? '+' : ''}{fmtNum(e.points)}</span> },
    { key: 'value', label: 'Value', align: 'right', sort: (e) => e.valueBase, render: (e) => <span className="num text-ink-3">{fmt.money(Math.abs(e.valueBase))}</span> },
    { key: 'status', label: 'Status', sort: (e) => e.status, render: (e) => <StatusPill status={liveStatus[e.status].pill} label={liveStatus[e.status].label} /> },
    { key: 'ref', label: 'Reference', render: (e) => <span className="text-ink-2">{[e.projectId, e.note].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'by', label: 'Posted by', render: (e) => <span className="text-ink-3">{e.createdBy}</span> },
  ];
  return (
    <Panel className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b hairline p-3">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Lock size={13} className="text-ink-3" /> Points ledger</span>
        <Badge tone="emerald">Live</Badge>
        <SearchInput value={q} onChange={setQ} placeholder="Handle, project or note…" className="ml-auto w-64" />
        <Segmented label="Entry type" size="sm" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, ...(['earn', 'redeem', 'adjust', 'expire'] as const).map((k) => ({ value: k, label: liveKind[k].label }))]} />
      </div>
      <DataTable caption="Points ledger from SUPPLY360, newest first" rows={shown.slice(0, limit)} columns={cols} getId={(e) => e.id} prefKey="ledger-live" />
      {shown.length === 0 && <p className="p-8 text-center text-[13px] text-ink-3">{rows.length ? 'No entries match.' : 'No points have been posted yet.'}</p>}
      {shown.length > limit && <div className="border-t hairline p-2 text-center"><Button size="xs" variant="ghost" onClick={() => setLimit((l) => l + 25)}>Show 25 more ({shown.length - limit} left)</Button></div>}
      <p className="px-4 py-2.5 text-2xs text-ink-3">The newest 200 entries. Entries are posted in Finance and can’t be edited; a correction is a new adjustment. Redemptions wait for a payment approval before they leave the balance.</p>
    </Panel>
  );
}

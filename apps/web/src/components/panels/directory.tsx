'use client';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { access } from '@/lib/core';
import { useOS } from '@/lib/store';
import { fmtNum, fmtPct } from '@/lib/utils';
import { Badge, Button, EmptyState, inputCls, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';

type Panelist = { id: string; brand: string; handle: string; country: string; ageBand: string; gender: string; segment: string; status: string; qualityScore: number; points: number; profileCompletion: number; surveysCompleted: number };
type Summary = { id: string; name: string; records: number; active: number; dormant: number; suspended: number; deletionRequested: number; avgQuality: number; note: string };
type Detail = Panelist & { consents: { id: string; purpose: string; granted: boolean; at: string }[] };

const brandName: Record<string, string> = { turn2opinion: 'Turn2Opinion', myfrequentrewards: 'MyFrequentRewards', myhealthopinions: 'MyHealthOpinions' };
const statusTone = { active: 'emerald', dormant: 'neutral', suspended: 'danger', deletion_requested: 'orange' } as const;
const PAGE = 12;

/**
 * Panelist directory backed by the API: pseudonymous records only (handle, demographics bands,
 * status, consent history). Consent changes and deletion requests are audited; deletion itself
 * waits for an approval.
 */
export function PanelistDirectory() {
  const mode = useOS((s) => s.mode);
  const role = useOS((s) => s.role);
  const toast = useOS((s) => s.toast);
  const canEdit = access(role, 'panels') === 'full';
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Panelist[] } | null>(null);
  const [summary, setSummary] = useState<Summary[] | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ skip: String(skip), take: String(PAGE), ...(brand ? { brand } : {}), ...(status ? { status } : {}) });
    const [d, s] = await Promise.all([api<{ total: number; rows: Panelist[] }>(`/panels/panelists?${q}`), api<Summary[]>('/panels/summary')]);
    setData(d);
    setSummary(s);
  }, [brand, status, skip]);
  useEffect(() => { if (mode === 'live') void load().catch(() => setData({ total: 0, rows: [] })); }, [mode, load]);

  const openRow = async (id: string) => setOpen(await api<Detail>(`/panels/panelists/${id}`));
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg, 'info'); if (open) await openRow(open.id).catch(() => setOpen(null)); await load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reach the API', 'warn'); }
  };

  if (mode !== 'live') {
    return <Panel className="mt-6"><PanelHeader eyebrow="Panelist directory" title="Member records" /><EmptyState title="Available when the API is running" body="The directory reads pseudonymous panelist records and consent history from the database." /></Panel>;
  }
  return (
    <Panel className="mt-6">
      <PanelHeader eyebrow="Panelist directory" title="Member records, consent and deletion requests" actions={<Badge tone="cyan">Synthetic records · no personal data</Badge>} />
      {summary && (
        <div className="mb-4 grid gap-2 text-[12px] sm:grid-cols-3">
          {summary.map((b) => (
            <div key={b.id} className="panel-solid p-3">
              <div className="font-semibold">{b.name}</div>
              <div className="num mt-1 text-ink-2">{fmtNum(b.records)} records · {fmtNum(b.active)} active · quality {fmtPct(b.avgQuality)}</div>
              {b.deletionRequested > 0 && <div className="mt-1 text-2xs text-orange">{b.deletionRequested} deletion request(s) awaiting approval</div>}
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Brand" className={`${inputCls} w-auto`} value={brand} onChange={(e) => { setBrand(e.target.value); setSkip(0); }}><option value="">All brands</option>{Object.entries(brandName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Status" className={`${inputCls} w-auto`} value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }}><option value="">Any status</option>{Object.keys(statusTone).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select>
        {data && <span className="ml-auto num text-2xs text-ink-3">{fmtNum(Math.min(data.total, skip + 1))}–{fmtNum(Math.min(data.total, skip + PAGE))} of {fmtNum(data.total)}</span>}
        <Button size="icon" variant="ghost" aria-label="Previous page" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}><ChevronLeft size={14} /></Button>
        <Button size="icon" variant="ghost" aria-label="Next page" disabled={!data || skip + PAGE >= data.total} onClick={() => setSkip(skip + PAGE)}><ChevronRight size={14} /></Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto">
          {!data ? <Skeleton className="h-64" /> : (
            <table className="w-full whitespace-nowrap text-[12.5px]">
              <thead><tr className="text-left text-2xs uppercase tracking-wider text-ink-3">{['Member', 'Brand', 'Country', 'Age', 'Segment', 'Status', 'Quality', 'Surveys'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id} onClick={() => void openRow(p.id)} className={`cursor-pointer border-t hairline hover:bg-surface-2/40 ${open?.id === p.id ? 'bg-blue/10' : ''}`}>
                    <td className="num px-2 py-2 font-medium">{p.handle}</td><td className="px-2 py-2">{brandName[p.brand]}</td><td className="px-2 py-2">{p.country}</td><td className="px-2 py-2">{p.ageBand}</td>
                    <td className="px-2 py-2 capitalize">{p.segment}</td><td className="px-2 py-2"><Badge tone={statusTone[p.status as keyof typeof statusTone] ?? 'neutral'}>{p.status.replace('_', ' ')}</Badge></td>
                    <td className="num px-2 py-2">{fmtPct(p.qualityScore, 0)}</td><td className="num px-2 py-2">{p.surveysCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel-solid p-4 text-[12.5px]">
          {!open ? <div className="text-ink-3">Select a member to see consent history.</div> : (
            <div className="space-y-3">
              <div className="flex items-center justify-between"><div><div className="num font-semibold">{open.handle}</div><div className="text-2xs text-ink-3">{brandName[open.brand]} · {open.country} · {open.ageBand} · {open.segment}</div></div><Badge tone={statusTone[open.status as keyof typeof statusTone] ?? 'neutral'}>{open.status.replace('_', ' ')}</Badge></div>
              <div>
                <div className="eyebrow mb-1">Consent history (latest first)</div>
                {open.consents.map((c) => <div key={c.id} className="flex justify-between border-t hairline py-1.5 text-2xs"><span>{c.purpose.replace(/_/g, ' ')}</span><span className={c.granted ? 'text-emerald' : 'text-orange'}>{c.granted ? 'granted' : 'withdrawn'} · {c.at.slice(0, 10)}</span></div>)}
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => act(() => api(`/panels/panelists/${open.id}/consents`, { method: 'POST', body: { purpose: 'marketing_email', granted: false } }), 'Marketing consent withdrawn and logged')}>Withdraw marketing consent</Button>
                  {open.status !== 'deletion_requested' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(() => api(`/panels/panelists/${open.id}/deletion-request`, { method: 'POST' }), 'Deletion request sent for approval')}><Trash2 size={12} /> Request deletion</Button>}
                </div>
              )}
              <p className="text-2xs text-ink-3">Records hold a pseudonymous handle and banded demographics only. Deleting a member requires an approval in Automation.</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

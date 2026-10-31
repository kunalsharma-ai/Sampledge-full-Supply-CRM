'use client';
import { useRef, useState } from 'react';
import { FileCheck2, Upload } from 'lucide-react';
import { panels, type PanelBrand } from '@/lib/core';
import { api, ApiError } from '@/lib/api';
import { useOS } from '@/lib/store';
import { access } from '@/lib/core';
import { fmtNum } from '@/lib/utils';
import { Badge, Button, inputCls } from '@/components/ui/primitives';

type Result = { dryRun: boolean; accepted: number; skipped: number; errorCount: number; errors: { row: number; message: string }[] };
const SAMPLE = 'handle,country,age_band,gender,segment,status,consent_research\nt2o_member_001,US,25-34,female,consumer,active,yes';

/** Member CSV import: validate (dry run) first, then import. Pseudonymous handles only. */
export function PanelImport() {
  const s = useOS();
  const canWrite = access(s.role, 'panels') === 'full';
  const [brand, setBrand] = useState<PanelBrand['id']>('turn2opinion');
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<Result>('/panels/import', { method: 'POST', body: { brand, csv, dryRun } });
      setRes(r);
      if (!dryRun) { s.toast(`Imported ${fmtNum(r.accepted)} member(s)`); setCsv(''); setFile(''); }
    } catch (e) {
      s.toast(e instanceof ApiError ? e.message : 'Could not reach the API', 'warn');
    } finally { setBusy(false); }
  };

  if (s.mode !== 'live') return <><p className="text-2xs text-ink-3">CSV member import with validation and a consent column. Needs the live API.</p><Button size="sm" className="mt-3" disabled><Upload size={12} /> Upload export</Button></>;
  return (
    <div className="space-y-2">
      <p className="text-2xs text-ink-3">Columns: handle, country, age_band, gender, segment, and optional status and consent_research. Rows containing an email address or phone number are rejected: only pseudonymous handles are stored.</p>
      <div className="flex gap-2">
        <select className={`${inputCls} h-8`} value={brand} onChange={(e) => { setBrand(e.target.value as PanelBrand['id']); setRes(null); }} aria-label="Panel brand">
          {panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 2_000_000) { s.toast('File is larger than 2 MB', 'warn'); return; } setCsv(await f.text()); setFile(f.name); setRes(null); }} />
        <Button size="sm" disabled={!canWrite} onClick={() => input.current?.click()}><Upload size={12} /> {file || 'Choose CSV'}</Button>
      </div>
      {!csv && <button type="button" className="text-2xs text-cyan hover:underline" onClick={() => { setCsv(SAMPLE); setFile('sample.csv'); setRes(null); }}>Use a one-row sample</button>}
      {csv && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => run(true)}><FileCheck2 size={12} /> Validate</Button>
          <Button size="sm" variant="primary" disabled={busy || !res?.dryRun || !res.accepted} onClick={() => run(false)}>Import {res?.dryRun && res.accepted ? fmtNum(res.accepted) : ''}</Button>
        </div>
      )}
      {res && (
        <div className="rounded-xl bg-surface-2/40 p-2 text-2xs" aria-live="polite">
          <div className="flex flex-wrap gap-1.5"><Badge tone="emerald">{fmtNum(res.accepted)} {res.dryRun ? 'valid' : 'imported'}</Badge><Badge>{fmtNum(res.skipped)} already exist</Badge><Badge tone={res.errorCount ? 'danger' : 'neutral'}>{fmtNum(res.errorCount)} rejected</Badge></div>
          {res.errors.slice(0, 5).map((e) => <div key={e.row} className="mt-1 text-ink-3">Row {e.row}: {e.message}</div>)}
        </div>
      )}
    </div>
  );
}

'use client';
/**
 * Screen 38 · Analytics & Reporting. A report builder: pick a metric and how to split it on the
 * left, read the chart and pivot table in the centre, then schedule or export it on the right.
 * Saved reports sit in a gallery on top and are kept in the user's preferences. "Export CSV"
 * downloads exactly the pivot on screen.
 * Live: the pivot runs over `GET /supply/facts` (counted from recorded sessions, cards, sign-ups and
 * points) and saved reports are `report` records (`/supply/records/report`), shared by the workspace.
 */
import { BarChart3, CalendarClock, Download, FileBarChart, LineChart, Save, Table2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Button, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader, fmt } from '@/components/supply/kit';
import { ApiError } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { loadFacts, records, type Rec } from '@/lib/supply/live';
import { panelBrands } from '@/lib/supply/demo';
import { demoFactSet, dimensions, factSet, metricsCatalog, pivot, starterReports, type DimId, type MetricId, type SavedReport } from '@/lib/supply/platform';
import { screenBySlug } from '@/lib/supply/screens';
import { series as palette } from '@/lib/tokens';
import { cn, fmtCompact } from '@/lib/utils';

const screen = screenBySlug('analytics')!;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank: SavedReport = { id: '', name: 'Untitled report', metric: 'completes', rows: 'week', cols: 'panel', chart: 'line', panels: [], schedule: 'off', recipients: [], owner: 'You' };
type ReportData = Omit<SavedReport, 'id' | 'owner'>;
type Sent = { nextSendAt?: string; lastSentAt?: string; error?: string; status?: string };
const fromRec = (x: Rec<ReportData & Sent>): SavedReport & { version: number } & Sent => ({ ...x.data, id: x.id, owner: x.createdBy, version: x.version, status: x.status });
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—');
const toData = (r: SavedReport): ReportData => ({ name: r.name, metric: r.metric, rows: r.rows, cols: r.cols, chart: r.chart, panels: r.panels, schedule: r.schedule, recipients: r.recipients });

export default function Analytics() {
  const toast = useOS((s) => s.toast);
  const live = useOS((s) => s.mode === 'live' && !!s.session);
  const localSaved = useOS((s) => s.prefs['reports:saved'] as SavedReport[] | undefined) ?? starterReports;
  const setPref = useOS((s) => s.setPref);
  const fs = useSupplyData('analytics:facts', () => demoFactSet, async () => { const f = await loadFacts(8); return factSet(f.facts, f.weeks, f.pointValue); });
  const shared = useSupplyData<(SavedReport & { version: number } & Sent)[] | null>('analytics:reports', () => null, async () => (await records.list<ReportData & Sent>('report')).filter((x) => x.status !== 'archived').map(fromRec));
  const saved: (SavedReport & { version?: number } & Sent)[] = live && shared.data ? shared.data : localSaved;
  const [sending, setSending] = useState(false);
  const [r, setR] = useState<SavedReport>({ ...starterReports[0] });
  const [recipients, setRecipients] = useState(starterReports[0].recipients.join(', '));
  const [del, setDel] = useState<SavedReport | null>(null);

  const m = metricsCatalog.find((x) => x.id === r.metric)!;
  const show = (v: number) => (m.unit === 'pct' ? fmt.pct(v) : m.unit === 'money' ? fmt.money(v) : fmtCompact(Math.round(v)));
  const pv = useMemo(() => pivot(r.metric, r.rows, r.cols, r.panels, fs.data), [r.metric, r.rows, r.cols, r.panels, fs.data]);
  const emails = recipients.split(',').map((s) => s.trim()).filter(Boolean);
  const badEmail = emails.find((e) => !EMAIL.test(e));
  const scheduleErr = r.schedule !== 'off' && !emails.length ? 'Add at least one recipient for a scheduled report.' : badEmail ? `“${badEmail}” is not an e-mail address.` : null;
  const set = (p: Partial<SavedReport>) => setR((x) => ({ ...x, ...p }));
  const load = (s: SavedReport) => { setR({ ...s }); setRecipients(s.recipients.join(', ')); };

  const save = async () => {
    if (scheduleErr || !r.name.trim()) return;
    if (live && shared.data) {
      const prev = shared.data.find((x) => x.id === r.id);
      const data = toData({ ...r, name: r.name.trim(), recipients: emails });
      try {
        const out = prev ? await records.update<ReportData>('report', prev, data) : await records.create<ReportData>('report', data);
        load(fromRec(out)); shared.reload();
        toast(`Saved “${out.data.name}” for the workspace${out.data.schedule !== 'off' ? `; it goes to ${out.data.recipients.length} recipient${out.data.recipients.length > 1 ? 's' : ''} ${out.data.schedule}` : ''}`, 'ok');
      } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save the report', 'warn'); }
      return;
    }
    const rec = { ...r, name: r.name.trim(), recipients: emails, id: r.id || `rp-${Date.now()}` };
    const list = saved.some((x) => x.id === rec.id) ? saved.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...saved];
    setPref('reports:saved', list); setR(rec);
    toast(rec.schedule === 'off' ? `Saved “${rec.name}”` : `Saved “${rec.name}”; it goes to ${emails.length} recipient${emails.length > 1 ? 's' : ''} ${rec.schedule}`, 'ok');
  };
  const exportCsv = () => {
    const head = [dimensions.find((d) => d.id === r.rows)!.label, ...pv.cols, 'Total'];
    const lines = [head, ...pv.rows.map((rv, i) => [rv, ...pv.cells[i].map((v) => (m.unit === 'int' ? Math.round(v) : v.toFixed(4))), m.unit === 'int' ? Math.round(pv.rowTotals[i]) : pv.rowTotals[i].toFixed(4)])];
    const csv = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${r.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'report'}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    toast(fs.source === 'live' ? 'CSV downloaded' : 'CSV downloaded (demo data)', 'ok');
  };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={fs.source} title="Analytics & reporting" subtitle="Build a report from a metric and a split, check the numbers in the pivot, then save, schedule or export it." />

      <section aria-label="Saved reports" className="flex gap-3 overflow-x-auto pb-1">
        <button onClick={() => load({ ...blank })} className="flex w-44 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-ink-3/35 p-3 text-[12.5px] text-ink-2 hover:border-primary/50"><FileBarChart size={18} aria-hidden />New report</button>
        {saved.map((s) => (
          <div key={s.id} className={cn('relative w-56 shrink-0 rounded-2xl border p-3', s.id === r.id ? 'border-primary/60 bg-primary/[.06]' : 'hairline bg-surface')}>
            <button onClick={() => load(s)} className="block w-full text-left"><span className="block truncate pr-6 text-[12.5px] font-semibold">{s.name}</span>
              <span className="mt-0.5 block text-2xs text-ink-3">{metricsCatalog.find((x) => x.id === s.metric)!.label} by {s.rows}{s.cols ? ` × ${s.cols}` : ''}</span>
              <span className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-3">{s.schedule !== 'off' ? <Badge tone="cyan"><CalendarClock size={10} /> {s.schedule}</Badge> : <Badge tone="neutral">Not scheduled</Badge>}</span></button>
            <button aria-label={`Delete ${s.name}`} onClick={() => setDel(s)} className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-danger/10 hover:text-danger"><Trash2 size={12} /></button>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[230px_1fr_280px]">
        <Panel className="space-y-4 p-4">
          <fieldset><legend className="eyebrow mb-1.5">Metric</legend>
            <div className="space-y-0.5">{metricsCatalog.map((x) => (
              <label key={x.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]', r.metric === x.id ? 'bg-primary/10 font-medium' : 'hover:bg-surface-2/60')}>
                <input type="radio" name="metric" className="accent-[rgb(var(--primary))]" checked={r.metric === x.id} onChange={() => set({ metric: x.id as MetricId })} />{x.label}
              </label>
            ))}</div>
          </fieldset>
          <label className="block text-2xs text-ink-3">Rows
            <select className={cn(inputCls, 'mt-1')} value={r.rows} onChange={(e) => { const v = e.target.value as DimId; set({ rows: v, cols: r.cols === v ? null : r.cols }); }}>{dimensions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          <label className="block text-2xs text-ink-3">Columns
            <select className={cn(inputCls, 'mt-1')} value={r.cols ?? ''} onChange={(e) => set({ cols: (e.target.value || null) as DimId | null })}><option value="">None (totals only)</option>{dimensions.filter((d) => d.id !== r.rows).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          <fieldset><legend className="mb-1 text-2xs text-ink-3">Panels</legend>
            <div className="flex flex-wrap gap-1">{panelBrands.map((b) => {
              const on = r.panels.includes(b.short);
              return <button key={b.id} aria-pressed={on} onClick={() => set({ panels: on ? r.panels.filter((p) => p !== b.short) : [...r.panels, b.short] })} className={cn('inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-2xs ring-1 ring-inset', on ? 'bg-surface text-ink ring-ink-3/40' : 'text-ink-3 ring-ink-3/20')}><span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden />{b.short}</button>;
            })}</div>
            <p className="mt-1 text-2xs text-ink-3">{r.panels.length ? `Only ${r.panels.join(', ')}` : 'All panels'}</p>
          </fieldset>
        </Panel>

        <Panel className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1"><span className="sr-only">Report name</span><input value={r.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!r.name.trim()} className="w-full bg-transparent font-display text-[17px] font-semibold outline-none focus:underline" /></label>
            <Segmented label="Chart type" size="sm" value={r.chart} onChange={(v) => set({ chart: v })} options={[{ value: 'bar', label: <span className="flex items-center gap-1"><BarChart3 size={12} />Bar</span> }, { value: 'line', label: <span className="flex items-center gap-1"><LineChart size={12} />Line</span> }, { value: 'table', label: <span className="flex items-center gap-1"><Table2 size={12} />Table</span> }]} />
          </div>
          <p className="mb-2 text-2xs text-ink-3">{m.label} by {r.rows}{r.cols ? ` and ${r.cols}` : ''}, last 8 weeks{fs.source === 'live' ? ', counted from recorded activity' : ''} · total <b className="num text-ink">{show(pv.total)}</b></p>
          {r.chart !== 'table' && (
            <EChart ariaLabel={`${m.label} by ${r.rows}`} height={280} deps={[r.metric, r.rows, r.cols, r.panels.join(), r.chart]} option={(t) => ({
              grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (v) => show(Number(v)) },
              legend: { top: 0, textStyle: { color: 'rgb(var(--ink-2))', fontSize: 11 } },
              xAxis: { type: 'category', data: pv.rows, ...axis(t) }, yAxis: { type: 'value', minInterval: m.unit === 'int' ? 1 : undefined, ...axis(t, { axisLabel: { color: 'rgb(var(--ink-3))', fontSize: 10, formatter: (v: number) => show(v) } }) },
              series: pv.cols.map((c, j) => ({ name: c, type: r.chart === 'line' ? 'line' : 'bar', stack: r.chart === 'bar' && m.unit === 'int' && r.cols ? 'a' : undefined, smooth: true, data: pv.cells.map((row) => row[j]), itemStyle: { color: (r.cols === 'panel' ? panelBrands.find((b) => b.short === c)?.color : undefined) ?? palette[j % palette.length] } })),
            })} />
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <caption className="sr-only">Pivot of {m.label}</caption>
              <thead><tr className="text-left text-2xs text-ink-3"><th scope="col" className="py-1.5 font-semibold">{dimensions.find((d) => d.id === r.rows)!.label}</th>{r.cols && pv.cols.map((c) => <th key={c} scope="col" className="py-1.5 text-right font-semibold">{c}</th>)}<th scope="col" className="py-1.5 text-right font-semibold">Total</th></tr></thead>
              <tbody>{pv.rows.map((rv, i) => <tr key={rv} className="border-t hairline"><th scope="row" className="py-1.5 text-left font-medium">{rv}</th>{r.cols && pv.cells[i].map((v, j) => <td key={j} className="num py-1.5 text-right">{show(v)}</td>)}<td className="num py-1.5 text-right font-semibold">{show(pv.rowTotals[i])}</td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 hairline"><th scope="row" className="py-1.5 text-left">All</th>{r.cols && pv.cols.map((c) => <td key={c} />)}<td className="num py-1.5 text-right font-bold">{show(pv.total)}</td></tr></tfoot>
            </table>
          </div>
        </Panel>

        <Panel className="space-y-4 p-4">
          <SectionTitle eyebrow="Delivery" title="Schedule and export" />
          <label className="block text-2xs text-ink-3">Send this report
            <select className={cn(inputCls, 'mt-1')} value={r.schedule} onChange={(e) => set({ schedule: e.target.value as SavedReport['schedule'] })}>
              <option value="off">Don’t schedule</option><option value="daily">Daily at 07:00</option><option value="weekly">Weekly, Monday 07:00</option><option value="monthly">Monthly, 1st at 07:00</option>
            </select></label>
          <label className="block text-2xs text-ink-3">Recipients (comma-separated)
            <textarea rows={2} className={cn(inputCls, 'mt-1 h-auto py-2')} value={recipients} onChange={(e) => setRecipients(e.target.value)} aria-invalid={!!scheduleErr} aria-describedby="rcpt-err" placeholder="name@company.com" /></label>
          <p id="rcpt-err" className={cn('-mt-2 text-2xs', scheduleErr ? 'text-danger' : 'text-ink-3')}>{scheduleErr ?? (live ? 'Members of this workspace only. They get an e-mail with the pivot as a table, at 07:00 UTC.' : 'Recipients get a PDF with the chart and a CSV of the pivot.')}</p>
          {live && (() => {
            const cur = shared.data?.find((x) => x.id === r.id);
            if (!cur) return null;
            const act = async (action: 'deliver' | 'restore') => {
              setSending(true);
              try { await records.act('report', { id: cur.id, version: cur.version }, action); toast(action === 'deliver' ? `“${cur.name}” sent to ${cur.recipients.length} team member${cur.recipients.length === 1 ? '' : 's'}` : `“${cur.name}” is back on schedule`, 'ok'); shared.reload(); }
              catch (e) { toast(e instanceof ApiError ? e.message : 'Could not send the report', 'warn'); } finally { setSending(false); }
            };
            return (
              <div className="space-y-1.5 rounded-xl bg-surface-2/40 p-3 text-2xs text-ink-2">
                {cur.status === 'failed' && <p className="text-danger">Last scheduled send failed: {cur.error ?? 'unknown error'}</p>}
                <p>Next send: <b className="text-ink">{cur.schedule === 'off' ? 'not scheduled' : cur.status === 'failed' ? 'paused until fixed' : when(cur.nextSendAt)}</b></p>
                <p>Last sent: <b className="text-ink">{when(cur.lastSentAt)}</b></p>
                <div className="flex gap-1.5 pt-1">
                  {cur.status === 'failed'
                    ? <Button size="xs" disabled={sending} onClick={() => void act('restore')}>Resume schedule</Button>
                    : <Button size="xs" variant="ghost" className="border hairline" disabled={sending || !cur.recipients.length} onClick={() => void act('deliver')}>Send now</Button>}
                </div>
              </div>
            );
          })()}
          <Button className="w-full" size="sm" variant="primary" disabled={!!scheduleErr || !r.name.trim()} onClick={save}><Save size={13} /> {saved.some((x) => x.id === r.id) ? 'Save changes' : 'Save report'}</Button>
          <Button className="w-full" size="sm" onClick={exportCsv}><Download size={13} /> Export CSV</Button>
          <p className="text-2xs text-ink-3">Exports contain aggregates only, never panellist identities.</p>
        </Panel>
      </div>

      <ConfirmDialog open={!!del} onOpenChange={(v) => !v && setDel(null)} title={`Delete “${del?.name ?? ''}”?`} body={del?.schedule !== 'off' ? 'Its schedule stops and recipients stop getting it.' : 'The report is removed from the gallery.'}
        confirmLabel="Delete" onConfirm={async () => {
          if (!del) return;
          if (live && shared.data) {
            const rec = shared.data.find((x) => x.id === del.id);
            try { if (rec) await records.act('report', rec, 'archive'); shared.reload(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete the report', 'warn'); setDel(null); return; }
          } else setPref('reports:saved', saved.filter((x) => x.id !== del.id));
          if (r.id === del.id) load({ ...blank }); toast(`Deleted “${del.name}”`, 'info'); setDel(null);
        }} />
    </div>
  );
}

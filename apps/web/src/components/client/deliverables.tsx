'use client';
import { useMemo, useState } from 'react';
import { Download, FileCheck2, Undo2 } from 'lucide-react';
import { access } from '@/lib/core';
import { api } from '@/lib/api';
import { act, shortDate, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { Badge, Button, EmptyState, Field, inputCls, Panel, PanelHeader } from '@/components/ui/primitives';
import { DataTable, Loadable } from '@/components/ui/data';

type Deliverable = {
  id: string; projectId: string; kind: Kind; title: string; note: string | null; fileName: string; size: number; sha256: string;
  status: 'pending_approval' | 'released' | 'rejected' | 'withdrawn'; createdBy: string; createdAt: string; releasedAt: string | null; downloads: number;
  project: { code: string; name: string };
};
type Kind = 'report_pdf' | 'report_pptx' | 'tables_xlsx' | 'responses_csv' | 'data_sav';
const kinds: { value: Kind; label: string; sensitive: boolean }[] = [
  { value: 'report_pdf', label: 'Report (PDF)', sensitive: false },
  { value: 'report_pptx', label: 'Report (PowerPoint)', sensitive: false },
  { value: 'tables_xlsx', label: 'Data tables (Excel)', sensitive: false },
  { value: 'responses_csv', label: 'Respondent-level data (CSV)', sensitive: true },
  { value: 'data_sav', label: 'Respondent-level data (SPSS)', sensitive: true },
];
const statusTone = { released: 'emerald', pending_approval: 'orange', rejected: 'neutral', withdrawn: 'neutral' } as const;
const statusLabel = { released: 'Released', pending_approval: 'Awaiting approval', rejected: 'Not approved', withdrawn: 'Withdrawn' } as const;
const size = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
const selectCls = `${inputCls} pr-8`;

/** Files released to the client. The team releases from a survey; respondent-level data needs an approval. */
export function DeliverablesPanel() {
  const s = useOS();
  const isClient = s.role === 'client';
  const canRelease = !isClient && access(s.role, 'client-portal') === 'full';
  const [tick, setTick] = useState(0);
  const list = useLive<Deliverable[]>('/deliverables', [tick]);
  const [projectId, setProjectId] = useState('');
  const [surveyId, setSurveyId] = useState('');
  const [kind, setKind] = useState<Kind>('report_pdf');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const surveys = useMemo(() => s.surveys.filter((x) => x.projectId === projectId), [s.surveys, projectId]);
  const sensitive = kinds.find((k) => k.value === kind)!.sensitive;

  const release = async () => {
    setBusy(true);
    const r = await act(() => api<Deliverable>('/deliverables', { method: 'POST', body: { projectId, surveyId, kind, note: note.trim() || undefined } }),
      (d) => (d.status === 'released' ? 'Released. The client can download it now.' : 'Prepared. It reaches the client once someone else approves the release.'));
    setBusy(false);
    if (r) { setNote(''); setTick((t) => t + 1); }
  };
  const withdraw = async (id: string) => { if (await act(() => api(`/deliverables/${id}/withdraw`, { method: 'POST' }), 'Withdrawn. The client can no longer download it.')) setTick((t) => t + 1); };

  return (
    <Panel>
      <PanelHeader eyebrow="Deliverables" title={isClient ? 'Reports and data from your team' : 'Files released to clients'} actions={<FileCheck2 size={16} className="text-ink-3" />}
        info="Each file is generated once when it is released and stored with its SHA-256, so the client downloads exactly what was released. Respondent-level data is a sensitive dataset: it needs an approval first." />
      {canRelease && (
        <div className="mb-4 grid gap-3 rounded-xl bg-surface-2/40 p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="Project">
            <select className={selectCls} value={projectId} onChange={(e) => { setProjectId(e.target.value); setSurveyId(''); }} aria-label="Project">
              <option value="">Choose…</option>{s.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Survey">
            <select className={selectCls} value={surveyId} onChange={(e) => setSurveyId(e.target.value)} disabled={!projectId} aria-label="Survey">
              <option value="">{projectId && !surveys.length ? 'No surveys on this project' : 'Choose…'}</option>{surveys.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="File" hint={sensitive ? 'Needs an approval before the client sees it' : 'Released straight away'}>
            <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="File type">
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <div className="flex items-start pt-[22px]"><Button variant="primary" disabled={!projectId || !surveyId || busy} onClick={release}>{sensitive ? 'Request release' : 'Release'}</Button></div>
          <div className="md:col-span-4"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note for the client (optional)" aria-label="Note for the client" /></div>
        </div>
      )}
      <Loadable q={list}>{(rows) => (
        <DataTable rows={rows} empty={<EmptyState title="No deliverables yet" body={isClient ? 'Reports and data files appear here when your team releases them.' : 'Release a report or dataset from a survey above.'} />} cols={[
          { key: 't', label: 'File', render: (d) => <div className="max-w-[340px]"><div className="truncate font-medium" title={d.title}>{d.title}</div><div className="truncate text-2xs text-ink-3" title={d.note ?? d.fileName}>{d.project.code} · {d.note ?? d.fileName}</div></div> },
          { key: 'z', label: 'Size', align: 'right', render: (d) => size(d.size) },
          { key: 'w', label: 'Released', render: (d) => (d.releasedAt ? shortDate(d.releasedAt) : '—') },
          ...(isClient ? [] : [{ key: 's', label: 'Status', render: (d: Deliverable) => <Badge tone={statusTone[d.status]} dot>{statusLabel[d.status]}</Badge> }, { key: 'n', label: 'Downloads', align: 'right' as const, render: (d: Deliverable) => d.downloads }]),
          { key: 'a', label: '', render: (d) => (
            <div className="flex justify-end gap-1">
              {(d.status === 'released' || !isClient) && <a className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs hover:bg-surface-2/60" href={`/api/v1/deliverables/${d.id}/download`} aria-label={`Download ${d.title}`} title={`SHA-256 ${d.sha256}`}><Download size={13} /> Download</a>}
              {canRelease && (d.status === 'released' || d.status === 'pending_approval') && <Button size="sm" variant="ghost" onClick={() => withdraw(d.id)} aria-label={`Withdraw ${d.title}`}><Undo2 size={13} /> Withdraw</Button>}
            </div>
          ) },
        ]} />
      )}</Loadable>
    </Panel>
  );
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, Flag, ShieldAlert } from 'lucide-react';
import type { QuestionResult } from '@/lib/core';
import { access } from '@/lib/core';
import { api } from '@/lib/api';
import { act, shortDate, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { cn, fmtNum, fmtPct } from '@/lib/utils';
import { Badge, Bar, Button, DemoBadge, EmptyState, Field, inputCls, Panel, PanelHeader, Segmented } from '@/components/ui/primitives';
import { LiveOnly, Loadable } from '@/components/ui/data';
import { ExploreViews } from './explore';

type SurveyRow = { id: string; name: string; status: string; completes: number; project?: { code: string } };
type Results = {
  survey: { id: string; name: string; version: number }; base: number; flagged: number; rejected: number; excludedFlagged: boolean;
  synthetic: number; weighted: boolean; weightingAvailable: boolean; effectiveBase: number;
  banner: { id: string; text: string; cols: { code: string; label: string; letter: string; base: number }[] } | null;
  questions: QuestionResult[];
};
type RespRow = { id: string; respondent: string; source: string; outcome: string | null; flags: string[]; rejectedAt: string | null; completedAt: string | null };
const flagLabel: Record<string, string> = { speeder: 'Speeder', straightliner: 'Straight-liner', duplicate: 'Duplicate', duplicate_device: 'Same browser as another complete', gibberish: 'Gibberish open end' };

function QuestionCard({ q, banner }: { q: QuestionResult; banner: Results['banner'] }) {
  return (
    <Panel>
      <PanelHeader eyebrow={`${q.id} · ${q.type} · base ${fmtNum(q.base)}`} title={q.text} />
      {(q.type === 'single' || q.type === 'multi') && (
        banner && q.rows[0]?.byBanner ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead><tr className="text-2xs text-ink-3"><th className="px-1.5 py-1 text-left font-medium" />
                <th className="px-1.5 py-1 text-right font-medium">Total</th>
                {banner.cols.map((c) => <th key={c.code} className="px-1.5 py-1 text-right font-medium">{c.label} <span className="text-cyan">({c.letter})</span><div className="num font-normal">n={c.base}</div></th>)}</tr></thead>
              <tbody>{q.rows.map((r) => (
                <tr key={r.code} className="border-t hairline">
                  <td className="px-1.5 py-1.5">{r.label}</td>
                  <td className="num px-1.5 py-1.5 text-right font-medium">{fmtPct(r.pct, 0)}</td>
                  {r.byBanner!.map((c, i) => <td key={i} className="num px-1.5 py-1.5 text-right">{c.base ? fmtPct(c.pct, 0) : '—'}{c.sig.length > 0 && <sup className="ml-0.5 font-semibold text-cyan">{c.sig.join('')}</sup>}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">{q.rows.map((r) => (
            <div key={r.code} className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 text-[12.5px]">
              <span className="truncate" title={r.label}>{r.label}</span><Bar value={r.pct} tone={q.type === 'multi' ? 'cyan' : 'blue'} /><span className="num text-right">{fmtPct(r.pct, 0)}</span>
            </div>
          ))}</div>
        )
      )}
      {q.type === 'numeric' && <div className="grid grid-cols-4 gap-2 text-center">{([['Mean', q.mean], ['Median', q.median], ['Min', q.min], ['Max', q.max]] as const).map(([l, v]) => <div key={l} className="panel-solid p-2"><div className="text-2xs text-ink-3">{l}</div><div className="num font-semibold">{fmtNum(v, 1)}</div></div>)}</div>}
      {q.type === 'nps' && (
        <div className="flex items-center gap-6">
          <div className="num font-display text-4xl font-semibold text-blue">{q.nps > 0 ? '+' : ''}{q.nps}</div>
          <div className="flex-1 space-y-1.5 text-[12px]">{([['Promoters', q.promoters, 'emerald'], ['Passives', q.passives, 'orange'], ['Detractors', q.detractors, 'danger']] as const).map(([l, v, t]) => <div key={l} className="grid grid-cols-[90px_1fr_40px] items-center gap-2"><span>{l}</span><Bar value={v} tone={t} /><span className="num text-right">{fmtPct(v, 0)}</span></div>)}</div>
        </div>
      )}
      {q.type === 'matrix' && (
        <table className="w-full text-[12px]"><thead><tr className="text-2xs text-ink-3"><th />{(q.rows[0]?.dist ?? []).map((d) => <th key={d.code} className="px-1 text-right font-medium">{d.label}</th>)}</tr></thead>
          <tbody>{q.rows.map((r) => <tr key={r.code} className="border-t hairline"><td className="py-1.5">{r.label}</td>{r.dist.map((d) => <td key={d.code} className="num px-1 text-right">{fmtPct(d.pct, 0)}</td>)}</tr>)}</tbody></table>
      )}
      {q.type === 'text' && q.coded && <div className="mb-3 space-y-2">{[...q.coded].sort((a, b) => b.pct - a.pct).map((r) => <div key={r.code} className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 text-[12.5px]"><span className="truncate">{r.label}</span><Bar value={r.pct} tone="cyan" /><span className="num text-right">{fmtPct(r.pct, 0)}</span></div>)}</div>}
      {q.type === 'text' && (q.samples.length ? <ul className="space-y-1 text-[12.5px]">{q.samples.slice(0, 6).map((t, i) => <li key={i} className="rounded-lg bg-surface-2/40 px-2 py-1">“{t}”</li>)}</ul> : <p className="text-2xs text-ink-3">No answers yet.</p>)}
    </Panel>
  );
}

function Inner() {
  const role = useOS((s) => s.role);
  const surveys = useLive<SurveyRow[]>('/surveys');
  const [sid, setSid] = useState('');
  const [banner, setBanner] = useState('');
  const [exclude, setExclude] = useState(false);
  const [weighted, setWeighted] = useState(false);
  const [tick, setTick] = useState(0);
  // Open the survey with the most recorded completes; with none anywhere, the first published one.
  useEffect(() => { if (!sid && surveys.data?.length) setSid(([...surveys.data].sort((a, b) => b.completes - a.completes)[0].completes ? [...surveys.data].sort((a, b) => b.completes - a.completes)[0] : surveys.data.find((s) => s.status === 'Published') ?? surveys.data[0]).id); }, [surveys.data, sid]);
  const qs = `banner=${encodeURIComponent(banner)}&excludeFlagged=${exclude}&weighted=${weighted}`;
  const res = useLive<Results>(sid ? `/surveys/${sid}/results?${qs}` : null, [sid, qs, tick]);
  const canQuality = access(role, 'survey-studio') === 'full';
  const resp = useLive<{ rows: RespRow[] }>(sid && canQuality ? `/surveys/${sid}/responses?outcome=complete&take=200` : null, [sid, tick]);
  const flagged = useMemo(() => (resp.data?.rows ?? []).filter((r) => r.flags.length && r.source !== 'preview'), [resp.data]);
  const bannerOpts = useMemo(() => (res.data?.questions ?? []).filter((q) => q.type === 'single'), [res.data]);
  const reject = (r: RespRow) => act(() => api(`/surveys/${sid}/responses/${r.id}/reject`, { method: 'POST', body: { reason: r.flags.map((f) => flagLabel[f] ?? f).join(', ') } }), 'Rejection sent for approval. Until then the interview stays in the results.').then(() => setTick((t) => t + 1));

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72"><Field label="Survey"><select className={inputCls} value={sid} onChange={(e) => { setSid(e.target.value); setBanner(''); setWeighted(false); }} aria-label="Survey">{(surveys.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status} · {s.completes} completes)</option>)}</select></Field></div>
          <div className="w-64"><Field label="Banner (columns)"><select className={inputCls} value={banner} onChange={(e) => setBanner(e.target.value)} aria-label="Banner question"><option value="">Total only</option>{bannerOpts.map((q) => <option key={q.id} value={q.id}>{q.id}: {q.text.slice(0, 40)}</option>)}</select></Field></div>
          <Segmented label="Flagged interviews" value={exclude ? 'ex' : 'in'} onChange={(v) => setExclude(v === 'ex')} options={[{ value: 'in', label: 'Include flagged' }, { value: 'ex', label: 'Exclude flagged' }]} />
          {res.data?.weightingAvailable && <Segmented label="Weighting" value={weighted ? 'w' : 'u'} onChange={(v) => setWeighted(v === 'w')} options={[{ value: 'u', label: 'Unweighted' }, { value: 'w', label: 'Weighted' }]} />}
          <span className="flex-1" />
          {sid && res.data && res.data.base > 0 && <a className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue px-3 text-[13px] font-medium text-white hover:opacity-90" href={`/api/v1/surveys/${sid}/report.pptx?${qs}`} download><Download size={14} /> PowerPoint report</a>}
          {sid && res.data && res.data.base > 0 && <a className="inline-flex h-9 items-center gap-1.5 rounded-xl border hairline px-3 text-[13px] hover:bg-surface-2/60" href={`/api/v1/surveys/${sid}/report.pdf?${qs}`} download><Download size={14} /> PDF</a>}
        </div>
        {res.data && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-2xs">
            <Badge tone="blue">Base {fmtNum(res.data.base)} completes</Badge>
            {res.data.weighted && <Badge tone="purple">Weighted · effective base {fmtNum(res.data.effectiveBase)}</Badge>}
            {res.data.synthetic > 0 && <DemoBadge label={`${fmtNum(res.data.synthetic)} synthetic interviews`} />}
            {res.data.flagged > 0 && <Badge tone="orange"><Flag size={10} /> {res.data.flagged} flagged{res.data.excludedFlagged ? ' (excluded)' : ' (included)'}</Badge>}
            {res.data.rejected > 0 && <Badge tone="danger">{res.data.rejected} rejected (excluded)</Badge>}
            {res.data.banner && <Badge tone="cyan">Letters: significantly higher than that column at 95% (n ≥ 30)</Badge>}
          </div>
        )}
      </Panel>

      <Loadable q={res}>{(r) => r.base === 0 ? (
        <Panel><EmptyState title="No completed interviews yet" body="Results appear here as respondents complete the published survey. Staff previews never count." /></Panel>
      ) : (
        <>
          <ExploreViews sid={sid} filters={{ excludeFlagged: exclude, weighted }} tick={tick} />
          <div className="grid gap-6 xl:grid-cols-2">{r.questions.map((q) => <QuestionCard key={q.id} q={q} banner={r.banner} />)}</div>
        </>
      )}</Loadable>

      {canQuality && (
        <Panel>
          <PanelHeader eyebrow="Data quality" title={`Flagged interviews (${flagged.length})`} info="Flags come from runtime checks: speeding, straight-lining, duplicate respondent references and gibberish open ends. Flagging never removes an interview; rejecting one needs a 'Rejecting respondents' approval from someone else." actions={<ShieldAlert size={16} className="text-orange" />} />
          {flagged.length ? (
            <div className="space-y-1.5">{flagged.map((r) => (
              <div key={r.id} className={cn('panel-solid flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]', r.rejectedAt && 'opacity-60')}>
                <span className="font-mono text-2xs">{r.id.slice(-8)}</span><span className="text-ink-3">{r.source} · {shortDate(r.completedAt)}</span>
                {r.flags.map((f) => <Badge key={f} tone="orange">{flagLabel[f] ?? f}</Badge>)}
                <span className="flex-1" />
                {r.rejectedAt ? <Badge tone="danger">Rejected</Badge> : <Button size="sm" onClick={() => reject(r)}>Request rejection</Button>}
              </div>
            ))}</div>
          ) : <EmptyState title="No flagged interviews" />}
        </Panel>
      )}
    </div>
  );
}

export function SurveyResults() {
  return <LiveOnly what="Survey results"><Inner /></LiveOnly>;
}

'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ClipboardCheck, Eye, FileUp, LayoutDashboard, Wand2, Workflow } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { can, runQA, type SurveyDef } from '@/lib/core';
import { api, ApiError } from '@/lib/api';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Download, ExternalLink, Send } from 'lucide-react';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { avg, cn, fmtNum, fmtPct, sum } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, DemoBadge, PageHeader, Panel, PanelHeader, SearchInput, Segmented } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';
import { LogicBuilder } from '@/components/survey/logic-builder';
import { SurveyPreview } from '@/components/survey/preview';
import { ImportPanel, ProgrammingAssistant, QaReport } from '@/components/survey/studio-tools';

type Tab = 'overview' | 'logic' | 'preview' | 'qa' | 'assistant' | 'import';

const qTypes = [
  ['Single select', 'live'], ['Multiple select', 'live'], ['Dropdown', 'live'], ['Text entry', 'live'], ['Numeric entry', 'live'], ['Rating scale', 'live'], ['Likert', 'live'], ['Matrix', 'live'], ['Ranking', 'live'], ['NPS', 'live'],
  ['Date & time', 'P3'], ['Slider', 'P3'], ['Constant sum', 'P3'], ['Semantic differential', 'P3'], ['Image selection', 'P3'], ['File upload', 'P3'], ['Video evaluation', 'P4'], ['Audio response', 'P4'], ['Heatmap', 'P4'], ['Click testing', 'P4'], ['Card sorting', 'P4'],
  ['MaxDiff', 'P5'], ['Conjoint', 'P5'], ['Choice-based conjoint', 'P5'], ['Van Westendorp', 'P5'], ['Gabor-Granger', 'P5'], ['TURF', 'P5'], ['Concept testing', 'P4'], ['Product testing', 'P4'], ['Brand tracking', 'P4'], ['Custom scripted', 'P6'],
] as const;

function StudioInner() {
  const s = useOS();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  const setTab = (t: Tab) => router.replace(`/survey-studio?tab=${t}${params.get('s') ? `&s=${params.get('s')}` : ''}`, { scroll: false });
  const defIds = Object.keys(s.surveyDefs);
  const [surveyId, setSurveyId] = useState(params.get('s') ?? 'sv-cloud');
  const def = s.surveyDefs[surveyId] ?? s.surveyDefs['sv-cloud'] ?? s.surveyDefs[defIds[0]];
  if (!def) return <EmptyState title="No programmed surveys you can open" body="Surveys appear here once they are programmed and shared with your role." />;
  return <StudioBody def={def} surveyId={surveyId} setSurveyId={setSurveyId} tab={tab} setTab={setTab} />;
}

/** Publishing goes through the API's approval gate; links open the real respondent runtime. */
function PublishBar({ def }: { def: SurveyDef }) {
  const s = useOS();
  const status = s.surveys.find((x) => x.id === def.id)?.status ?? 'Draft';
  const [busy, setBusy] = useState(false);
  const request = async () => {
    setBusy(true);
    try {
      const r = await api<{ alreadyPending: boolean }>(`/surveys/${def.id}/publish`, { method: 'POST' });
      s.toast(r.alreadyPending ? 'A publish request is already waiting for approval' : 'Publish request sent to the approval queue', 'info');
      void s.refresh();
    } catch (e) {
      s.toast(e instanceof ApiError ? e.message : 'Could not reach the API', 'warn');
    } finally {
      setBusy(false);
    }
  };
  const tone = { Draft: 'neutral', 'In QA': 'orange', Published: 'emerald', Closed: 'purple' } as const;
  return (
    <div className="panel-solid mb-4 flex flex-wrap items-center gap-2 p-3 text-[12.5px]">
      <Badge tone={tone[status]} dot>{status}</Badge><span className="text-ink-3">v{def.version}</span>
      {s.mode === 'live' ? (
        <>
          <a href={`/r/${def.id}?preview=1`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-cyan hover:underline">Preview as respondent <ExternalLink size={12} /></a>
          <a href={`/api/v1/surveys/${def.id}/responses.csv`} className="inline-flex items-center gap-1 text-cyan hover:underline" download>Responses CSV <Download size={12} /></a>
          {status === 'Published' && <a href={`/r/${def.id}?src=direct`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan hover:underline">Live link <ExternalLink size={12} /></a>}
          {can(s.role, 'edit:surveys') && status !== 'Published' && <Button size="sm" variant="primary" disabled={busy} onClick={request}><Send size={12} /> Request publish</Button>}
        </>
      ) : <span className="ml-auto text-2xs text-ink-3">Offline demo: publishing and respondent links need the API</span>}
    </div>
  );
}

function StudioBody({ def, surveyId, setSurveyId, tab, setTab }: { def: SurveyDef; surveyId: string; setSurveyId: (v: string) => void; tab: Tab; setTab: (t: Tab) => void }) {
  const s = useOS();
  void surveyId;
  const defIds = Object.keys(s.surveyDefs);
  const qa = useMemo(() => runQA(def, 300), [def]);
  const issuesByQ = useMemo(() => qa.issues.reduce<Record<string, number>>((m, i) => (i.questionId ? { ...m, [i.questionId]: (m[i.questionId] ?? 0) + 1 } : m), {}), [qa]);
  const [q, setQ] = useState('');
  const list = s.surveys.filter((v) => v.name.toLowerCase().includes(q.toLowerCase()));
  const statusTone = { Draft: 'neutral', 'In QA': 'orange', Published: 'emerald', Closed: 'purple' } as const;
  const programmers = [...new Set(s.surveys.map((v) => v.programmer))];

  return (
    <div>
      <PageHeader eyebrow="AI Survey Programming Studio" title="Survey Studio" subtitle="Schema-driven questionnaires with a visual logic builder, deterministic runtime, live preview and automated QA."
        actions={<><DemoBadge />
          {tab !== 'overview' && tab !== 'import' && <select aria-label="Survey" className="h-9 rounded-xl border hairline bg-surface-2/40 px-3 text-xs" value={def.id} onChange={(e) => setSurveyId(e.target.value)}>{defIds.map((id) => <option key={id} value={id}>{s.surveyDefs[id].name} · v{s.surveyDefs[id].version}</option>)}</select>}</>} />

      <div className="mb-6 overflow-x-auto">
        <Segmented label="studio-tab" value={tab} onChange={setTab} options={[
          { value: 'overview', label: <span className="flex items-center gap-1.5"><LayoutDashboard size={12} />Dashboard</span> },
          { value: 'logic', label: <span className="flex items-center gap-1.5"><Workflow size={12} />Logic builder</span> },
          { value: 'preview', label: <span className="flex items-center gap-1.5"><Eye size={12} />Preview & test</span> },
          { value: 'qa', label: <span className="flex items-center gap-1.5"><ClipboardCheck size={12} />Automated QA {qa.issues.length > 0 && <span className="rounded-full bg-danger/20 px-1.5 text-[10px] text-danger">{qa.issues.length}</span>}</span> },
          { value: 'assistant', label: <span className="flex items-center gap-1.5"><Wand2 size={12} />AI assistant</span> },
          { value: 'import', label: <span className="flex items-center gap-1.5"><FileUp size={12} />Import</span> },
        ]} />
      </div>

      {tab === 'overview' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <KpiCard label="Active survey projects" value={s.surveys.filter((v) => v.status !== 'Closed').length} format={(n) => fmtNum(n)} color="rgb(var(--blue))" />
            <KpiCard label="Draft questionnaires" value={s.surveys.filter((v) => v.status === 'Draft').length} format={(n) => fmtNum(n)} />
            <KpiCard label="Awaiting QA" value={s.surveys.filter((v) => v.status === 'In QA').length} format={(n) => fmtNum(n)} color="rgb(var(--orange))" />
            <KpiCard label="Published" value={s.surveys.filter((v) => v.status === 'Published').length} format={(n) => fmtNum(n)} color="rgb(var(--emerald))" />
            <KpiCard label="Avg programming time" value={avg(s.surveys.map((v) => v.hoursSpent))} format={(n) => `${n.toFixed(1)} h`} deltaGoodWhen="down" color="rgb(var(--purple))" />
            <KpiCard label="Quality alerts" value={sum(s.surveys.map((v) => v.alerts))} format={(n) => fmtNum(n)} status={{ tone: 'warn', text: 'Across open surveys' }} color="rgb(var(--danger))" />
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel className="p-0">
              <div className="flex items-center justify-between gap-3 p-5 pb-3"><h2 className="font-display text-[15px] font-semibold">Surveys</h2><SearchInput value={q} onChange={setQ} placeholder="Find survey" className="w-56" /></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]">
                  <thead className="text-2xs uppercase tracking-wider text-ink-3"><tr className="border-y hairline">{['Survey', 'Status', 'Questions', 'Logic complexity', 'LOI', 'Completion', 'Alerts', 'Programmer'].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {list.map((v) => {
                      const live = s.surveyDefs[v.id];
                      return (
                        <tr key={v.id} onClick={() => live && (setSurveyId(v.id), setTab('logic'))} className={cn('border-b hairline last:border-0', live ? 'cursor-pointer hover:bg-surface-2/40' : '')}>
                          <td className="px-4 py-2.5 font-medium">{v.name}{live && <Badge tone="cyan" className="ml-2">editable</Badge>}<div className="text-2xs text-ink-3">{v.languages.map((l) => l.toUpperCase()).join(' · ')}</div></td>
                          <td className="px-4 py-2.5"><Badge tone={statusTone[v.status]} dot>{v.status}</Badge></td>
                          <td className="num px-4 py-2.5">{live ? live.questions.length : v.questions}</td>
                          <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => <span key={i} className={cn('h-3 w-1.5 rounded-sm', i < Math.round(v.complexity * 5) ? (v.complexity > 0.7 ? 'bg-orange' : 'bg-cyan') : 'bg-ink-3/20')} />)}</div><span className="num text-2xs text-ink-3">{Math.round(v.complexity * 100)}</span></div></td>
                          <td className="num px-4 py-2.5">{v.loi}m</td><td className="num px-4 py-2.5">{v.status === 'Draft' ? '—' : fmtPct(v.completionRate, 0)}</td>
                          <td className="px-4 py-2.5">{v.alerts ? <span className="flex items-center gap-1 text-orange"><AlertTriangle size={12} />{v.alerts}</span> : <span className="text-ink-3">0</span>}</td>
                          <td className="px-4 py-2.5 text-ink-2">{v.programmer}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="space-y-6">
              <Panel>
                <PanelHeader eyebrow="Workload" title="Programming hours by programmer and status" />
                <EChart ariaLabel="Programming workload" height={220} deps={[s.surveys]} option={(t) => ({
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { right: 0 }, grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
                  xAxis: { type: 'category', data: programmers, ...axis(t), splitLine: { show: false } }, yAxis: { type: 'value', ...axis(t) },
                  series: (['Draft', 'In QA', 'Published', 'Closed'] as const).map((st, i) => ({ name: st, type: 'bar', stack: 'h', barWidth: 26, itemStyle: { color: [palette.blue, palette.orange, palette.emerald, palette.purple][i], borderRadius: 3 }, data: programmers.map((p) => +sum(s.surveys.filter((v) => v.programmer === p && v.status === st).map((v) => v.hoursSpent)).toFixed(1)) })),
                })} />
              </Panel>
              <Panel>
                <PanelHeader eyebrow="Performance" title="Logic complexity vs completion rate" actions={<DemoBadge />} />
                <EChart ariaLabel="Complexity vs completion" height={220} deps={[]} option={(t) => ({
                  tooltip: { formatter: (p: unknown) => { const d = (p as { data: (number | string)[] }).data; return `${d[3]}<br/>complexity ${d[0]} · completion ${(Number(d[1]) * 100).toFixed(0)}% · LOI ${d[2]}m`; } },
                  xAxis: { type: 'value', name: 'Complexity', nameTextStyle: { color: '#707EA8', fontSize: 10 }, min: 0, max: 1, ...axis(t) },
                  yAxis: { type: 'value', min: 0.5, max: 1, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
                  series: [{ type: 'scatter', data: s.surveys.filter((v) => v.status !== 'Draft').map((v) => [v.complexity, v.completionRate, v.loi, v.name]), symbolSize: (d: number[]) => 6 + d[2] * 0.9, itemStyle: { color: palette.cyan, opacity: 0.8, borderColor: palette.blue } }],
                })} />
              </Panel>
            </div>
          </div>
          <Panel className="mt-6">
            <PanelHeader eyebrow="Question library" title="Supported question types and methodologies" actions={<span className="text-2xs text-ink-3">“live” = runs in the Phase 2 engine and preview</span>} />
            <div className="flex flex-wrap gap-1.5">{qTypes.map(([n, st]) => <Badge key={n} tone={st === 'live' ? 'emerald' : st === 'P5' ? 'purple' : 'neutral'}>{n} · {st}</Badge>)}</div>
            <p className="mt-3 text-2xs text-ink-3">MaxDiff, conjoint, Van Westendorp, Gabor-Granger and TURF will ship with statistically valid design generation and estimation (balanced incomplete block designs, HB/MNL estimation) in Phase 5. They are not simulated here.</p>
          </Panel>
        </>
      )}
      {(tab === 'logic' || tab === 'qa' || tab === 'preview') && <PublishBar def={def} />}
      {tab === 'logic' && <LogicBuilder def={def} issuesByQ={issuesByQ} />}
      {tab === 'preview' && <SurveyPreview key={def.id + def.version} def={def} />}
      {tab === 'qa' && <Panel><PanelHeader eyebrow="Automated survey QA" title={`QA report · ${def.name} v${def.version}`} /><QaReport key={def.id} def={def} /></Panel>}
      {tab === 'assistant' && <Panel><PanelHeader eyebrow="AI survey programming assistant" title="Instruct, review the diff, apply or undo" actions={<DemoBadge label="Rule-based" />} /><ProgrammingAssistant def={def} /></Panel>}
      {tab === 'import' && <Panel><PanelHeader eyebrow="Questionnaire import" title="Document → structured survey draft" /><ImportPanel /></Panel>}
    </div>
  );
}

export default function SurveyStudioPage() { return <Suspense><StudioInner /></Suspense>; }

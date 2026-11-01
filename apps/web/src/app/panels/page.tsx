'use client';
import { motion } from 'motion/react';
import { HeartPulse, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { access, panels, type PanelBrand } from '@/lib/core';
import { api } from '@/lib/api';
import { act, shortDate, useLive } from '@/lib/live';
import { useOS } from '@/lib/store';
import { palette } from '@/lib/tokens';
import { cn, fmtCompact, fmtMoney, fmtNum, fmtPct } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi';
import { Badge, Button, EmptyState, Field, inputCls, PageHeader, Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { EChart, axis } from '@/components/charts/echart';
import { PanelistDirectory } from '@/components/panels/directory';
import { PanelImport } from '@/components/panels/import';
import { PanelBackendPanel } from '@/components/panels/backend';
import { PanelSyncPanel } from '@/components/panels/sync';

type Sel = 'all' | PanelBrand['id'];
type RewardCat = { id: string; name: string; maxLoi: number; points: number; minQuality: number };
type Policy = { version: number; categories: RewardCat[]; redemptionThreshold: number; weeklyInviteCap: number; createdBy: string; createdAt: string; note: string | null };
type Analytics = {
  asOf: string; currency: string; pointValue: number;
  cards: { id: PanelBrand['id']; name: string; domain: string; focus: string; color: string; registered: number; active: number; avgQuality: number; profileCompletion: number; rewardLiability: number }[];
  kpis: { registered: number; active: number; active90: number; newLast30: number; profileCompletion: number; inactive90Share: number; rewardLiability: number };
  profileFunnel: { stage: string; n: number }[];
  pyramid: { ageBand: string; female: number; male: number; other: number }[];
  quality: number[];
  monthly: { month: string; registrations: number; activeMembers: number; surveyStarts: number }[];
  cohorts: { month: string; size: number; retained: (number | null)[] }[];
  engagement: { lowProfile: number; inactive60: number; dormant: number; suspended: number; deletionRequested: number };
  health: { segments: Record<string, number>; healthDataConsents: number };
};

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const DEFAULT_CATS: RewardCat[] = [
  { id: 'short', name: 'Short reward', maxLoi: 10, points: 50, minQuality: 0.6 },
  { id: 'high', name: 'High reward', maxLoi: 30, points: 250, minQuality: 0.8 },
];

/** Reward categories, redemption threshold and invitation cap, saved as a new policy version. */
function RewardPolicyPanel({ canEdit }: { canEdit: boolean }) {
  const { data, reload } = useLive<{ current: Policy | null; history: { version: number; createdBy: string; createdAt: string; note: string | null }[] }>('/panels/reward-policy');
  const [cats, setCats] = useState<RewardCat[]>(DEFAULT_CATS);
  const [threshold, setThreshold] = useState(1000);
  const [freqCap, setFreqCap] = useState(3);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const c = data?.current;
    if (c) { setCats(c.categories); setThreshold(c.redemptionThreshold); setFreqCap(c.weeklyInviteCap); }
  }, [data]);
  const save = async () => {
    setSaving(true);
    const r = await act(() => api<Policy>('/panels/reward-policy', { method: 'PUT', body: { categories: cats, redemptionThreshold: threshold, weeklyInviteCap: freqCap, ...(note.trim() ? { note: note.trim() } : {}) } }), (p) => `Reward policy v${p.version} saved and in force`);
    setSaving(false);
    if (r) { setNote(''); void reload(); }
  };
  const cur = data?.current;
  return (
    <Panel>
      <PanelHeader eyebrow="Reward policy" title="Reward categories and limits" actions={<Badge tone={cur ? 'emerald' : 'orange'}>{cur ? `v${cur.version} in force` : 'Not set yet'}</Badge>} />
      <div className="space-y-3">
        {cats.map((c, i) => (
          <div key={i} className="panel-solid grid grid-cols-3 gap-2 p-3">
            <div className="col-span-3 flex items-center gap-2">
              <input aria-label="Category name" className={cn(inputCls, 'font-semibold')} value={c.name} disabled={!canEdit} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, name: e.target.value, id: x.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) } : x)))} />
              {canEdit && cats.length > 1 && <Button size="sm" variant="ghost" aria-label="Remove category" onClick={() => setCats(cats.filter((_, j) => j !== i))}><Trash2 size={12} /></Button>}
            </div>
            <Field label="Max LOI (min)"><input type="number" className={inputCls} value={c.maxLoi} disabled={!canEdit} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, maxLoi: +e.target.value } : x)))} /></Field>
            <Field label="Points"><input type="number" className={inputCls} value={c.points} disabled={!canEdit} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, points: +e.target.value } : x)))} /></Field>
            <Field label="Min quality"><input type="number" step={0.05} min={0} max={1} className={inputCls} value={c.minQuality} disabled={!canEdit} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, minQuality: +e.target.value } : x)))} /></Field>
          </div>
        ))}
        {canEdit && cats.length < 10 && <Button size="sm" variant="ghost" onClick={() => setCats([...cats, { id: `cat-${cats.length + 1}`, name: `Category ${cats.length + 1}`, maxLoi: 45, points: 400, minQuality: 0.8 }])}><Plus size={12} /> Add category</Button>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Redemption threshold (pts)"><input type="number" className={inputCls} value={threshold} disabled={!canEdit} onChange={(e) => setThreshold(+e.target.value)} /></Field>
          <Field label="Max invitations / member / week"><input type="number" className={inputCls} value={freqCap} disabled={!canEdit} onChange={(e) => setFreqCap(+e.target.value)} /></Field>
        </div>
        {canEdit && <Field label="Change note (optional)"><input className={inputCls} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Why the policy changed" /></Field>}
        {canEdit && <Button size="sm" variant="primary" className="w-full" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save as new version'}</Button>}
        <p className="text-2xs text-ink-3">Redemptions below the threshold are refused by the incentive ledger. {cur ? `v${cur.version} saved by ${cur.createdBy} on ${shortDate(cur.createdAt)}.` : 'Until a policy is saved, no threshold applies.'}</p>
        {!!data?.history.length && data.history.length > 1 && (
          <details className="text-2xs text-ink-3"><summary className="cursor-pointer">Version history ({data.history.length})</summary>
            <ul className="mt-1 space-y-0.5">{data.history.map((h) => <li key={h.version}>v{h.version} · {h.createdBy} · {shortDate(h.createdAt)}{h.note ? ` · ${h.note}` : ''}</li>)}</ul>
          </details>
        )}
      </div>
    </Panel>
  );
}

export default function PanelsPage() {
  const role = useOS((s) => s.role);
  const canEdit = access(role, 'panels') === 'full';
  const [sel, setSel] = useState<Sel>('all');
  const { data: d, error } = useLive<Analytics>(`/panels/analytics${sel === 'all' ? '' : `?brand=${sel}`}`, [sel]);
  const k = d?.kpis;
  const empty = !!d && d.kpis.registered === 0;

  return (
    <div>
      <PageHeader eyebrow="Proprietary Panel Management" title="Panels" subtitle="Three independent panel identities, managed centrally. Figures are counted from the panel member records in this workspace."
        actions={<Segmented label="panel" value={sel} onChange={setSel} options={[{ value: 'all', label: 'All panels' }, ...panels.map((p) => ({ value: p.id, label: p.name }))]} />} />

      {error && <EmptyState title="Panel analytics unavailable" body={error} />}

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {(d?.cards ?? []).map((p, i) => (
          <motion.button key={p.id} onClick={() => setSel(sel === p.id ? 'all' : p.id)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className={cn('panel relative overflow-hidden p-4 text-left transition-shadow', sel === p.id && 'ring-1 ring-inset ring-cyan/50')}>
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-30 blur-2xl" style={{ background: p.color }} />
            <div className="relative flex items-start justify-between gap-2">
              <div><div className="font-display text-base font-bold">{p.name}</div><div className="text-2xs text-ink-3">{p.domain} · {p.focus}</div></div>
              {p.id === 'myhealthopinions' ? <HeartPulse size={18} className="text-emerald" /> : null}
            </div>
            <div className="relative mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div><div className="text-2xs text-ink-3">Members</div><div className="num font-jakarta font-bold">{fmtCompact(p.registered)}</div></div>
              <div><div className="text-2xs text-ink-3">Status active</div><div className="num font-jakarta font-bold">{fmtCompact(p.active)}</div></div>
              <div><div className="text-2xs text-ink-3">Avg quality</div><div className="num font-jakarta font-bold">{fmtPct(p.avgQuality, 0)}</div></div>
            </div>
          </motion.button>
        ))}
        {!d && !error && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}
      </div>

      {k && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <KpiCard label="Panel members" value={k.registered} format={(n) => fmtCompact(n)} color="rgb(var(--blue))" />
          <KpiCard label="Active in 90 days" value={k.active90} format={(n) => fmtCompact(n)} tooltip="Members whose last activity is within 90 days" />
          <KpiCard label="Joined in 30 days" value={k.newLast30} format={(n) => fmtNum(n)} color="rgb(var(--purple))" />
          <KpiCard label="Profile completion" value={k.profileCompletion} format={(n) => fmtPct(n, 0)} color="rgb(var(--emerald))" />
          <KpiCard label="Inactive 90 days+" value={k.inactive90Share} format={(n) => fmtPct(n)} deltaGoodWhen="down" color="rgb(var(--orange))" tooltip="Share of members with no activity in 90 days" />
          <KpiCard label="Reward liability" value={k.rewardLiability} format={(n) => fmtMoney(n)} status={{ tone: 'warn', text: `Unredeemed points at ${d!.pointValue} ${d!.currency} each` }} color="rgb(var(--magenta))" />
        </div>
      )}

      {empty ? <EmptyState title="No panel members yet" body="Import members from a CSV file or sync them from a panel backend below; the analytics fill in from those records." /> : d && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel>
            <PanelHeader eyebrow="Profiling" title="Member profile funnel" />
            <EChart ariaLabel="Member profile funnel" height={250} deps={[d]} option={() => ({
              tooltip: { trigger: 'item', formatter: '{b}: {c}' },
              series: [{ type: 'funnel', sort: 'none', gap: 3, minSize: '30%', left: 10, right: 10, top: 4, bottom: 4, label: { position: 'inside', color: '#fff', fontSize: 11, formatter: '{b}  {c}' },
                data: d.profileFunnel.map((f, i) => ({ name: f.stage, value: f.n, itemStyle: { color: [palette.blue, '#3B7BFB', palette.cyan, palette.emerald, palette.purple][i] } })) }],
            })} />
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Demographics" title="Age and gender pyramid" />
            <EChart ariaLabel="Population pyramid" height={250} deps={[d]} option={(t) => ({
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmtNum(Math.abs(Number(v))) }, legend: { right: 0 },
              grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(Math.abs(v)) } },
              yAxis: { type: 'category', data: d.pyramid.map((x) => x.ageBand), ...axis(t), splitLine: { show: false } },
              series: [
                { name: 'Female', type: 'bar', stack: 'p', barWidth: 14, data: d.pyramid.map((x) => -x.female), itemStyle: { color: palette.magenta, borderRadius: [4, 0, 0, 4] } },
                { name: 'Male', type: 'bar', stack: 'p', barWidth: 14, data: d.pyramid.map((x) => x.male), itemStyle: { color: palette.cyan, borderRadius: [0, 4, 4, 0] } },
              ],
            })} />
            {d.pyramid.some((x) => x.other) && <p className="mt-1 text-2xs text-ink-3">{fmtNum(d.pyramid.reduce((s, x) => s + x.other, 0))} members are non-binary or undisclosed and not shown in the pyramid.</p>}
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Quality" title="Member quality score distribution" />
            <EChart ariaLabel="Quality distribution" height={250} deps={[d]} option={(t) => ({
              tooltip: { trigger: 'axis' }, grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: d.quality.map((_, i) => `${i * 10}–${i * 10 + 10}`), ...axis(t), splitLine: { show: false } },
              yAxis: { type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(v) } },
              series: [{ type: 'bar', barWidth: '70%', data: d.quality.map((v, i) => ({ value: v, itemStyle: { borderRadius: [4, 4, 0, 0], color: i < 5 ? palette.danger : i < 7 ? palette.orange : palette.emerald } })) }],
            })} />
          </Panel>
          <Panel className="xl:col-span-2">
            <PanelHeader eyebrow="Engagement" title="Members active, sign-ups and survey starts by month" />
            <EChart ariaLabel="Engagement trends" height={260} deps={[d]} option={(t) => ({
              tooltip: { trigger: 'axis' }, legend: { right: 0 },
              xAxis: { type: 'category', data: d.monthly.map((m) => monthLabel(m.month)), ...axis(t), splitLine: { show: false } },
              yAxis: [{ type: 'value', ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(v) } }, { type: 'value', ...axis(t), splitLine: { show: false }, axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmtCompact(v) } }],
              series: [
                { name: 'Last active in month', type: 'line', symbol: 'circle', symbolSize: 4, data: d.monthly.map((m) => m.activeMembers), lineStyle: { width: 2.5, color: palette.blue }, areaStyle: { color: 'rgba(36,107,253,.15)' } },
                { name: 'Panel survey starts', type: 'line', symbol: 'circle', symbolSize: 4, data: d.monthly.map((m) => m.surveyStarts), lineStyle: { width: 2, color: palette.cyan } },
                { name: 'Sign-ups', type: 'bar', yAxisIndex: 1, barWidth: 14, data: d.monthly.map((m) => m.registrations), itemStyle: { color: 'rgba(113,59,255,.6)', borderRadius: [4, 4, 0, 0] } },
              ],
            })} />
          </Panel>
          <Panel>
            <PanelHeader eyebrow="Retention" title="Sign-up cohorts still active" />
            <EChart ariaLabel="Cohort retention heatmap" height={240} deps={[d]} option={(t) => ({
              tooltip: { formatter: (p: unknown) => { const v = (p as { data: number[] }).data; const c = d.cohorts[v[1]]; return `${monthLabel(c.month)} cohort (${c.size}) · month ${v[0]}: ${(v[2] * 100).toFixed(0)}% active since`; } },
              grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'], ...axis(t), splitLine: { show: false } },
              yAxis: { type: 'category', data: d.cohorts.map((c) => `${monthLabel(c.month)} (${c.size})`), inverse: true, ...axis(t), splitLine: { show: false } },
              visualMap: { show: false, min: 0, max: 1, inRange: { color: ['#1B2A5C', palette.purple, palette.cyan] } },
              series: [{ type: 'heatmap', label: { show: true, color: '#fff', fontSize: 10, formatter: (p: unknown) => `${Math.round((p as { data: number[] }).data[2] * 100)}` }, itemStyle: { borderColor: t === 'dark' ? '#080D1F' : '#F4F6FC', borderWidth: 2, borderRadius: 4 },
                data: d.cohorts.flatMap((c, ci) => c.retained.map((v, m) => (v == null ? null : [m, ci, v])).filter((x): x is number[] => !!x)) }],
            })} />
            <p className="mt-1 text-2xs text-ink-3">Share of each month&apos;s sign-ups whose last activity falls in or after that month.</p>
          </Panel>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <RewardPolicyPanel canEdit={canEdit} />
        <Panel>
          <PanelHeader eyebrow="Engagement signals" title="Members who need attention" />
          {!d ? <Skeleton className="h-40" /> : (
            <ul className="space-y-2 text-[12.5px]">
              {([
                ['Profile under 60%', 'Active members with incomplete profiles', d.engagement.lowProfile, 'cyan'],
                ['No activity in 60 days', 'Active members who have gone quiet', d.engagement.inactive60, 'orange'],
                ['Dormant', 'Candidates for a re-engagement message (Comms Hub; large sends need approval)', d.engagement.dormant, 'neutral'],
                ['Suspended', 'Excluded from invitations', d.engagement.suspended, 'danger'],
                ['Deletion requested', 'Waiting on a Deleting records approval', d.engagement.deletionRequested, 'orange'],
              ] as const).map(([n, d2, v, tone]) => (
                <li key={n} className="flex items-start justify-between gap-3 border-b hairline pb-2 last:border-0">
                  <span><span className="block font-medium">{n}</span><span className="block text-2xs text-ink-3">{d2}</span></span>
                  <Badge tone={tone}>{fmtNum(v)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader eyebrow="MyHealthOpinions" title="Healthcare members and consent" actions={<ShieldCheck size={16} className="text-emerald" />} />
          {!d ? <Skeleton className="h-40" /> : (
            <div className="space-y-3 text-[12.5px]">
              {([['hcp', 'Healthcare professionals', 'emerald'], ['patient', 'Patients', 'cyan'], ['caregiver', 'Caregivers', 'purple']] as const).map(([key, label, c]) => (
                <div key={key} className="panel-solid flex items-center justify-between p-3">
                  <span className="flex items-center gap-2 font-semibold"><span className={cn('h-2 w-2 rounded-full', c === 'emerald' ? 'bg-emerald' : c === 'cyan' ? 'bg-cyan' : 'bg-purple')} />{label}</span>
                  <span className="num font-jakarta font-bold">{fmtNum(d.health.segments[key] ?? 0)}</span>
                </div>
              ))}
              <div className="panel-solid flex items-center justify-between p-3"><span>Health-data consents granted</span><span className="num font-jakarta font-bold">{fmtNum(d.health.healthDataConsents)}</span></div>
              <p className="flex gap-2 text-2xs text-ink-3"><Lock size={12} className="mt-0.5 shrink-0" /> Health data needs its own consent, recorded per member and append-only. Member records are pseudonymous: no names, contact details or health records are stored.</p>
            </div>
          )}
        </Panel>
      </div>

      <PanelistDirectory />

      <PanelBackendPanel />
      <PanelSyncPanel />

      <Panel className="mt-6">
        <PanelHeader eyebrow="Integration" title="Connect existing panel websites" actions={<Badge tone="orange">Adapters not connected</Badge>} />
        <div className="grid gap-4 text-[12.5px] md:grid-cols-3">
          <div className="panel-solid p-4"><div className="mb-1 font-semibold">1. Secure file import</div><PanelImport /></div>
          <div className="panel-solid p-4"><div className="mb-1 font-semibold">2. Panel backend adapter</div><p className="text-2xs text-ink-3">Built for the Turn2Opinion backend API (above). Active per panel once its URL and app token are configured; verified against a local stand-in only so far.</p></div>
          <div className="panel-solid p-4"><div className="mb-1 font-semibold">3. Event sync</div><p className="text-2xs text-ink-3">Survey invitations, completes and reward ledger posted back to each panel. Planned with the panel adapters (not connected).</p></div>
        </div>
      </Panel>
    </div>
  );
}

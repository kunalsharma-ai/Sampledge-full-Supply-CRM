'use client';
/**
 * Screen 7 · Panellist 360° Profile. Three columns: compact identity panel, interactive profile
 * sections with engagement history and rewards timeline, and an operational action rail.
 * Live mode reads GET /panels/panelists/:id (consents included); history is demo until the
 * activity and ledger APIs exist.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BadgeCheck, Ban, Coins, Mail, MessageSquarePlus, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { Badge, Bar, Button, Panel, ProgressRing } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Tabs, TabsContent, TabsList } from '@/components/ui/overlay';
import { ValidatedInput } from '@/components/ui/forms';
import { StatusPill, type Status } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { api } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { fromApiPanelist, historyFor, panellistById, panellists, type Panellist } from '@/lib/supply/panellists';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('panellists/profile')!;
const outcomeStatus: Record<string, Status> = { complete: 'completed', screenout: 'rejected', 'quota-full': 'quota-full', dropout: 'paused' };

export default function Panellist360() {
  const { id } = useParams<{ id: string }>();
  const q = useSupplyData(`panellist:${id}`, () => panellistById(id) ?? panellists()[0], async () => fromApiPanelist(await api(`/panels/panelists/${id}`)));
  const base = q.data;
  const toast = useOS((s) => s.toast);
  const [p, setP] = useState<Panellist | null>(null);
  const cur = p && p.id === base.id ? p : base;
  const h = useMemo(() => historyFor(cur), [cur.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [points, setPoints] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<{ at: string; text: string }[]>([]);
  const [confirm, setConfirm] = useState<'suspend' | 'delete' | null>(null);
  const update = (patch: Partial<Panellist>) => setP({ ...cur, ...patch });

  const sections = [
    { key: 'demo', title: 'Demographic', items: [['Age band', cur.ageBand], ['Gender', cur.gender], ['Country', cur.country], ['Language', cur.language], ['Income', cur.income], ['Education', cur.education], ['Employment', cur.employment], ['Device', cur.device]] },
    ...(cur.segment === 'professional' ? [{ key: 'b2b', title: 'B2B', items: [['Industry', cur.industry], ['Job role', cur.jobRole], ['Company size', cur.companySize], ['Seniority', cur.seniority]] }] : []),
    ...(cur.segment === 'hcp' || cur.conditions.length ? [{ key: 'hc', title: 'Healthcare', items: [['Specialty', cur.specialty], ['Years in practice', cur.yearsPractice], ['Conditions', cur.conditions.join(', ') || undefined], ['Credential', cur.verified.credential === undefined ? undefined : cur.verified.credential ? 'Verified' : 'Pending']] }] : []),
  ];
  const statusPill: Status = cur.status === 'active' ? 'active' : cur.status === 'dormant' ? 'paused' : cur.status === 'suspended' ? 'flagged' : 'closed';
  const completes = h.surveys.filter((s) => s.outcome === 'complete').length;

  return (
    <div className="space-y-4">
      <Link href="/supply/panellists" className="inline-flex items-center gap-1 text-2xs font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={12} /> Panellists</Link>
      <SupplyHeader screen={screen} source={q.source === 'live' ? 'mixed' : 'demo'} title={<span className="flex flex-wrap items-center gap-3">{cur.handle} <StatusPill status={statusPill} label={cur.status.replace('_', ' ')} /></span>}
        subtitle={<span className="flex flex-wrap items-center gap-2"><PanelChip panel={cur.brand} /> · <span className="font-mono">{cur.id}</span> · joined {cur.joinedAt} · last active {cur.lastActiveAt ?? 'never'}</span>} />

      <div className="grid gap-4 xl:grid-cols-[280px_1fr_240px]">
        {/* Identity */}
        <Panel className="h-fit space-y-4 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary-strong to-primary-2 font-display text-lg font-bold text-on-primary" aria-hidden>{cur.handle.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0"><div className="truncate font-semibold">{cur.handle}</div><div className="text-2xs capitalize text-ink-3">{cur.specialty ?? cur.jobRole ?? cur.segment} · {cur.country}</div></div>
          </div>
          <div className="flex items-center justify-around">
            <ProgressRing value={cur.qualityScore} size={64} stroke={6} color={cur.qualityScore < 0.6 ? 'rgb(var(--danger))' : 'rgb(var(--emerald))'} sub="quality" />
            <ProgressRing value={cur.profileCompletion} size={64} stroke={6} color="rgb(var(--primary))" sub="profile" />
            <ProgressRing value={cur.responseRate} size={64} stroke={6} color="rgb(var(--cyan))" sub="response" />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
            <div><dt className="text-2xs text-ink-3">Points</dt><dd className="num font-jakarta text-base font-bold">{fmtNum(cur.points)}</dd></div>
            <div><dt className="text-2xs text-ink-3">Surveys</dt><dd className="num font-jakarta text-base font-bold">{cur.surveysCompleted}</dd></div>
          </dl>
          <div>
            <div className="eyebrow mb-1.5">Verification</div>
            <ul className="space-y-1 text-[12.5px]">
              {(Object.entries(cur.verified) as [string, boolean][]).map(([k, ok]) => (
                <li key={k} className="flex items-center gap-2">{ok ? <BadgeCheck size={14} className="text-emerald" /> : <XCircle size={14} className="text-ink-3" />}<span className="capitalize">{k}</span><span className="ml-auto text-2xs text-ink-3">{ok ? 'verified' : 'not verified'}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Consent</div>
            <ul className="space-y-1 text-[12.5px]">
              {(Object.entries(cur.consents) as [string, boolean][]).map(([k, ok]) => (
                <li key={k} className="flex items-center justify-between"><span>{k.replace(/_/g, ' ')}</span><Badge tone={ok ? 'emerald' : 'neutral'}>{ok ? 'granted' : 'not granted'}</Badge></li>
              ))}
            </ul>
          </div>
          {cur.risk.length > 0 && <div className="rounded-xl bg-danger/10 p-2.5 text-2xs text-danger">Risk signal: {cur.risk.join(', ')}. Review in Quality & Risk.</div>}
        </Panel>

        {/* Sections */}
        <Panel className="min-w-0 p-4">
          <Tabs defaultValue="profile">
            <TabsList tabs={[{ value: 'profile', label: 'Profile' }, { value: 'engagement', label: 'Engagement', count: h.surveys.length }, { value: 'rewards', label: 'Rewards', count: h.ledger.length }, { value: 'timeline', label: 'Timeline' }]} />
            <TabsContent value="profile" className="pt-4">
              <div className="grid gap-3 md:grid-cols-2">
                {sections.map((s) => {
                  const filled = s.items.filter(([, v]) => v !== undefined && v !== '—').length;
                  return (
                    <section key={s.key} className="panel-solid p-3">
                      <div className="mb-2 flex items-center justify-between"><h3 className="text-[13px] font-semibold">{s.title}</h3><span className="num text-2xs text-ink-3">{filled}/{s.items.length}</span></div>
                      <Bar value={filled / s.items.length} tone={filled === s.items.length ? 'emerald' : 'orange'} className="mb-2 h-1" />
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                        {s.items.map(([k, v]) => <div key={String(k)}><dt className="text-2xs text-ink-3">{k}</dt><dd className={cn('capitalize', v === undefined && 'text-ink-3 italic normal-case')}>{v ?? 'missing'}</dd></div>)}
                      </dl>
                    </section>
                  );
                })}
              </div>
            </TabsContent>
            <TabsContent value="engagement" className="space-y-4 pt-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                {[['Completion rate', `${Math.round((completes / h.surveys.length) * 100)}%`], ['Avg LOI', `${Math.round(h.surveys.reduce((s, x) => s + x.loi, 0) / h.surveys.length)}m`], ['Last invite', `${cur.lastInviteDaysAgo}d ago`]].map(([k, v]) => (
                  <div key={k} className="panel-solid p-2.5"><div className="text-2xs text-ink-3">{k}</div><div className="num font-jakarta text-lg font-bold">{v}</div></div>
                ))}
              </div>
              <EChart ariaLabel="Surveys completed per month over the last 12 months" height={150} deps={[cur.id]} option={(t) => ({
                grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true }, tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'], ...axis(t, { splitLine: { show: false } }) },
                yAxis: { type: 'value', ...axis(t) }, series: [{ type: 'bar', name: 'Surveys', data: h.monthly, barWidth: 14, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
              })} />
              <ul className="divide-y divide-[rgb(var(--line)/var(--line-alpha))] text-[12.5px]">
                {h.surveys.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2"><span className="w-20 text-2xs text-ink-3">{s.at}</span><span className="flex-1 truncate">{s.title}</span><Badge tone={s.source === 'PROJEXA' ? 'orange' : 'magenta'}>{s.source}</Badge><span className="num w-10 text-right text-2xs text-ink-3">{s.loi}m</span><StatusPill status={outcomeStatus[s.outcome]} label={s.outcome} /></li>
                ))}
              </ul>
            </TabsContent>
            <TabsContent value="rewards" className="pt-4">
              <ol className="relative space-y-3 border-l hairline pl-4">
                {h.ledger.map((t) => (
                  <li key={t.id} className="relative">
                    <span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-bg', t.amount < 0 ? 'bg-orange' : t.kind === 'bonus' ? 'bg-purple' : 'bg-emerald')} aria-hidden />
                    <div className="flex items-center gap-3 text-[12.5px]">
                      <span className="w-20 text-2xs text-ink-3">{t.at}</span><span className="flex-1">{t.memo}</span>
                      {t.status === 'pending' && <StatusPill status="pending" />}
                      <span className={cn('num w-16 text-right font-semibold', t.amount < 0 ? 'text-orange' : 'text-emerald')}>{t.amount > 0 ? '+' : ''}{fmtNum(t.amount)}</span>
                      <span className="num w-16 text-right text-2xs text-ink-3">{fmtNum(t.balance)}</span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-2xs text-ink-3">Ledger entries are immutable. Corrections are new entries with a reason, never edits.</p>
            </TabsContent>
            <TabsContent value="timeline" className="pt-4">
              <ul className="space-y-2 text-[12.5px]">
                {[...notes.map((n) => ({ ...n, text: `Note: ${n.text}` })), ...h.events].map((e, i) => <li key={i} className="flex gap-3"><span className="w-20 shrink-0 text-2xs text-ink-3">{e.at}</span><span>{e.text}</span></li>)}
              </ul>
            </TabsContent>
          </Tabs>
        </Panel>

        {/* Action rail */}
        <Panel className="h-fit space-y-2 p-4">
          <SectionTitle eyebrow="Actions" title="Operate" />
          <Button size="sm" className="w-full justify-start" onClick={() => toast('Message drafted in Email Campaign Designer (demo)', 'info')}><Mail size={13} /> Send message</Button>
          <Button size="sm" className="w-full justify-start" onClick={() => setPoints(true)}><Coins size={13} /> Adjust points…</Button>
          <Button size="sm" className="w-full justify-start" onClick={() => toast('Identity re-check requested (demo)', 'info')}><ShieldCheck size={13} /> Re-run verification</Button>
          <div className="pt-2">
            <label className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-ink-3" htmlFor="note">Internal note</label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-xl border hairline bg-surface-2/40 p-2 text-[12.5px] outline-none focus:border-primary/60" placeholder="Visible to supply staff only" />
            <Button size="xs" variant="subtle" disabled={!note.trim()} onClick={() => { setNotes([{ at: new Date().toISOString().slice(0, 10), text: note.trim() }, ...notes]); setNote(''); toast('Note added'); }}><MessageSquarePlus size={12} /> Add note</Button>
          </div>
          <div className="space-y-2 border-t hairline pt-3">
            {cur.status === 'suspended'
              ? <Button size="sm" variant="success" className="w-full justify-start" onClick={() => { update({ status: 'active' }); toast('Reinstated'); }}><BadgeCheck size={13} /> Reinstate</Button>
              : <Button size="sm" variant="danger" className="w-full justify-start" onClick={() => setConfirm('suspend')}><Ban size={13} /> Suspend…</Button>}
            <Button size="sm" variant="ghost" className="w-full justify-start text-danger" onClick={() => setConfirm('delete')}><Trash2 size={13} /> Request deletion…</Button>
          </div>
        </Panel>
      </div>

      <Dialog open={points} onOpenChange={setPoints}>
        <DialogContent title="Adjust points" description="Creates a new ledger entry. Adjustments over 2,000 points need a second approver.">
          <div className="grid gap-2 sm:grid-cols-2">
            <ValidatedInput label="Points (+ or −)" value={amount} onChange={setAmount} placeholder="e.g. 250 or -100" validate={(v) => !/^-?\d+$/.test(v.trim()) ? 'Enter a whole number' : Number(v) === 0 ? 'Cannot be zero' : cur.points + Number(v) < 0 ? 'Balance cannot go below zero' : null} hint={`Current balance ${fmtNum(cur.points)}`} />
            <ValidatedInput label="Reason" value={reason} onChange={setReason} placeholder="Shown in the ledger" validate={(v) => v.trim().length < 8 ? 'Give a reason of at least 8 characters' : null} />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setPoints(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={!/^-?\d+$/.test(amount.trim()) || Number(amount) === 0 || cur.points + Number(amount) < 0 || reason.trim().length < 8}
              onClick={() => { const n = Number(amount); if (Math.abs(n) > 2000) toast('Sent for second approval (over 2,000 points)', 'info'); else { update({ points: cur.points + n }); toast(`${n > 0 ? 'Added' : 'Removed'} ${fmtNum(Math.abs(n))} points`); } setPoints(false); setAmount(''); setReason(''); }}>Create entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirm === 'suspend'} onOpenChange={(v) => !v && setConfirm(null)} title={`Suspend ${cur.handle}?`} confirmLabel="Suspend"
        body="They stop receiving invitations and cannot redeem until reinstated. Points are held, not removed." onConfirm={() => { update({ status: 'suspended' }); toast(`${cur.handle} suspended`, 'warn'); }} />
      <ConfirmDialog open={confirm === 'delete'} onOpenChange={(v) => !v && setConfirm(null)} title="Request deletion?" confirmLabel="Request deletion" typeToConfirm={cur.handle}
        body="Starts the deletion workflow. A data-protection approver must confirm before records are erased. This cannot be undone once approved. Live mode calls POST /panels/panelists/:id/deletion-request."
        onConfirm={async () => {
          if (q.source === 'live') { try { await api(`/panels/panelists/${cur.id}/deletion-request`, { method: 'POST' }); } catch { toast('Could not reach the API', 'warn'); return; } }
          update({ status: 'deletion_requested' }); toast('Deletion requested. Waiting for approval.', 'warn');
        }} />
    </div>
  );
}

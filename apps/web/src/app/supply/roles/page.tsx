'use client';
/**
 * Screen 40 · User Roles & Permissions. A role × capability matrix for SUPPLY360. Edits are a
 * draft: changed cells are marked, and "Review changes" shows a diff with how many people each
 * change affects before anything is saved. Platform admin can't lose settings access (that would
 * lock everyone out), and panellist identity is never viewable by any role. Per-person overrides
 * are temporary: they need a reason and expire within 30 days.
 * Integration: the API enforces `packages/core` roles; `PUT /admin/roles/:id/capabilities` and
 * `POST /admin/overrides` (planned).
 */
import { Lock, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { capabilities, levels, overrides as seedOv, roleMatrix, supplyRoles, type CapId, type Level, type Override, type SupplyRole } from '@/lib/supply/platform';
import { screenBySlug } from '@/lib/supply/screens';
import { cn } from '@/lib/utils';

const screen = screenBySlug('roles')!;
const rank: Record<Level, number> = { none: 0, view: 1, edit: 2, approve: 3 };
const levelCls: Record<Level, string> = { none: 'text-ink-3', view: 'text-ink-2', edit: 'text-blue font-semibold', approve: 'text-emerald font-semibold' };
const TODAY = '2026-11-06';
const daysTo = (d: string) => Math.round((Date.parse(d) - Date.parse(TODAY)) / 86400000);
const locked = (role: SupplyRole, cap: CapId) => role === 'platform_admin' && (cap === 'settings' || cap === 'api');
const sensitive: CapId[] = ['health', 'points', 'redemptions', 'settings', 'api'];

export default function Roles() {
  const toast = useOS((s) => s.toast);
  const [saved, setSaved] = useState(roleMatrix);
  const [draft, setDraft] = useState(roleMatrix);
  const [review, setReview] = useState(false);
  const [ov, setOv] = useState<Override[]>(seedOv);
  const [adding, setAdding] = useState(false);
  const [removeOv, setRemoveOv] = useState<Override | null>(null);

  const diff = useMemo(() => supplyRoles.flatMap((r) => capabilities.filter((c) => draft[r.id][c.id] !== saved[r.id][c.id]).map((c) => ({ role: r, cap: c, from: saved[r.id][c.id], to: draft[r.id][c.id] }))), [draft, saved]);
  const setCell = (role: SupplyRole, cap: CapId, v: Level) => setDraft((d) => ({ ...d, [role]: { ...d[role], [cap]: v } }));
  const groups = [...new Set(capabilities.map((c) => c.group))];

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Roles & permissions" subtitle="Who can see and do what in SUPPLY360. Changes are a draft until you review and save them."
        actions={diff.length > 0 && <>
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}><RotateCcw size={13} /> Discard</Button>
          <Button size="sm" variant="primary" onClick={() => setReview(true)}>Review {diff.length} change{diff.length > 1 ? 's' : ''}</Button>
        </>} />

      <Panel className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-[12.5px]">
            <caption className="sr-only">Permission level for each role and capability</caption>
            <thead><tr className="border-b hairline text-left">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 text-2xs font-semibold text-ink-3">Capability</th>
              {supplyRoles.map((r) => <th key={r.id} scope="col" className="px-2 py-3 text-center"><div className="text-[12px] font-semibold">{r.label}</div><div className="text-2xs font-normal text-ink-3">{r.people} people</div></th>)}
            </tr></thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr><th colSpan={supplyRoles.length + 1} scope="colgroup" className="bg-surface-2/40 px-4 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-ink-3">{g}</th></tr>
                {capabilities.filter((c) => c.group === g).map((c) => (
                  <tr key={c.id} className="border-t hairline">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">{c.label}{sensitive.includes(c.id) && <ShieldAlert size={11} className="ml-1 inline text-warn" aria-label="Sensitive" />}<span className="block text-2xs font-normal text-ink-3">{c.hint}</span></th>
                    {supplyRoles.map((r) => {
                      const v = draft[r.id][c.id], changed = v !== saved[r.id][c.id], lk = locked(r.id, c.id);
                      return (
                        <td key={r.id} className={cn('px-2 py-1.5 text-center', changed && 'bg-warn/10')}>
                          {lk ? <span className="inline-flex items-center gap-1 text-2xs text-ink-3" title="Platform admin always keeps this, so nobody is locked out"><Lock size={11} aria-hidden />{v}</span> : (
                            <select aria-label={`${r.label}: ${c.label}`} value={v} onChange={(e) => setCell(r.id, c.id, e.target.value as Level)}
                              className={cn('h-8 rounded-lg border bg-transparent px-1.5 text-[12px] capitalize outline-none focus:border-primary/60', changed ? 'border-warn/60' : 'border-transparent hover:border-ink-3/30', levelCls[v])}>
                              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody><tr className="border-t hairline"><th scope="row" className="sticky left-0 bg-surface px-4 py-2 text-left font-medium">Panellist identity (names, e-mail)<span className="block text-2xs font-normal text-ink-3">Not available to any role; screens show pseudonymous handles</span></th>
              <td colSpan={supplyRoles.length} className="px-2 py-2 text-center text-2xs text-ink-3"><Lock size={11} className="mr-1 inline" aria-hidden />Never</td></tr></tbody>
          </table>
        </div>
        <p className="border-t hairline px-4 py-2.5 text-2xs text-ink-3">Levels: none, view, edit (make changes), approve (also confirm other people’s changes). Changed cells are highlighted until saved.</p>
      </Panel>

      <Panel className="p-4">
        <SectionTitle eyebrow="Temporary" title="Per-person overrides" actions={<Button size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Add override</Button>} />
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Per-person overrides</caption>
          <thead><tr className="text-left text-2xs text-ink-3"><th scope="col" className="py-1.5 font-semibold">Person</th><th scope="col" className="py-1.5 font-semibold">Gets</th><th scope="col" className="py-1.5 font-semibold">Reason</th><th scope="col" className="py-1.5 font-semibold">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{ov.map((o) => {
            const left = daysTo(o.expires);
            return (
              <tr key={o.id} className="border-t hairline">
                <td className="py-2"><div className="font-medium">{o.person}</div><div className="text-2xs text-ink-3">{supplyRoles.find((r) => r.id === o.role)!.label}</div></td>
                <td className="py-2"><span className={cn('capitalize', levelCls[o.level])}>{o.level}</span> on {capabilities.find((c) => c.id === o.cap)!.label.toLowerCase()} <span className="text-2xs text-ink-3">(role has {roleMatrix[o.role][o.cap]})</span></td>
                <td className="py-2 text-ink-2">{o.reason}</td>
                <td className="py-2"><Badge tone={left <= 7 ? 'warn' : 'neutral'}>{left <= 0 ? 'Expired' : `in ${left} days`}</Badge></td>
                <td className="py-2 text-right"><Button size="xs" variant="ghost" aria-label={`Remove override for ${o.person}`} onClick={() => setRemoveOv(o)}><Trash2 size={12} /></Button></td>
              </tr>
            );
          })}</tbody>
        </table>
        {ov.length === 0 && <p className="py-4 text-center text-2xs text-ink-3">No overrides. Everyone has exactly their role’s access.</p>}
      </Panel>

      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent wide title="Review permission changes" description="These apply to everyone in each role as soon as you save. The audit trail records who changed what.">
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {diff.map((d) => {
              const up = rank[d.to] > rank[d.from];
              return (
                <li key={`${d.role.id}-${d.cap.id}`} className="rounded-xl border hairline p-2.5 text-[12.5px]">
                  <div><b>{d.role.label}</b> · {d.cap.label}: <span className="capitalize text-ink-3 line-through">{d.from}</span> → <span className={cn('capitalize', levelCls[d.to])}>{d.to}</span></div>
                  <div className="mt-0.5 text-2xs text-ink-3">{d.role.people} people {up ? 'gain' : 'lose'} access{sensitive.includes(d.cap.id) && up ? '. Sensitive: check this is intended.' : '.'}</div>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <DialogClose asChild><Button size="sm" variant="ghost">Keep editing</Button></DialogClose>
            <Button size="sm" variant="primary" onClick={() => { setSaved(draft); setReview(false); toast(`Saved ${diff.length} permission change${diff.length > 1 ? 's' : ''}`, 'ok'); }}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!removeOv} onOpenChange={(v) => !v && setRemoveOv(null)} title="Remove this override?" body={removeOv ? `${removeOv.person} goes back to the ${supplyRoles.find((r) => r.id === removeOv.role)!.label.toLowerCase()} role’s access straight away.` : ''}
        confirmLabel="Remove" onConfirm={() => { if (removeOv) { setOv((l) => l.filter((x) => x.id !== removeOv.id)); toast('Override removed', 'info'); setRemoveOv(null); } }} />
      <AddOverride open={adding} onOpenChange={setAdding} onAdd={(o) => { setOv((l) => [o, ...l]); toast(`${o.person} has ${o.level} on ${o.cap} until ${o.expires}`, 'ok'); }} />
    </div>
  );
}

function AddOverride({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (v: boolean) => void; onAdd: (o: Override) => void }) {
  const [f, setF] = useState({ person: '', role: 'support_agent' as SupplyRole, cap: 'redemptions' as CapId, level: 'edit' as Level, reason: '', expires: '2026-11-20' });
  const base = roleMatrix[f.role][f.cap];
  const errs = {
    person: f.person.trim().length < 3 ? 'Who is this for?' : null,
    level: rank[f.level] <= rank[base] ? `The role already has ${base}. An override must grant more.` : null,
    reason: f.reason.trim().length < 10 ? 'Say why, in a sentence' : null,
    expires: !f.expires || daysTo(f.expires) < 1 ? 'Must be after today' : daysTo(f.expires) > 30 ? 'At most 30 days' : null,
  };
  const valid = Object.values(errs).every((e) => !e);
  const field = (label: string, err: string | null, input: React.ReactNode) => <label className="block text-2xs text-ink-3">{label}{input}{err && <span className="mt-0.5 block text-danger">{err}</span>}</label>;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a temporary override" description="Grants one person more access than their role, until the expiry date.">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">{field('Person', f.person ? errs.person : null, <input className={cn(inputCls, 'mt-1')} value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} placeholder="Name" />)}</div>
          {field('Their role', null, <select className={cn(inputCls, 'mt-1')} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as SupplyRole })}>{supplyRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>)}
          {field('Capability', null, <select className={cn(inputCls, 'mt-1')} value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value as CapId })}>{capabilities.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>)}
          {field('Level', errs.level, <select className={cn(inputCls, 'mt-1 capitalize')} value={f.level} aria-invalid={!!errs.level} onChange={(e) => setF({ ...f, level: e.target.value as Level })}>{levels.filter((l) => l !== 'none').map((l) => <option key={l} value={l}>{l}</option>)}</select>)}
          {field('Expires', errs.expires, <input type="date" className={cn(inputCls, 'mt-1')} value={f.expires} aria-invalid={!!errs.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />)}
          <div className="col-span-2">{field('Reason', f.reason ? errs.reason : null, <input className={cn(inputCls, 'mt-1')} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Covering approvals during leave" />)}</div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button size="sm" variant="ghost">Cancel</Button></DialogClose>
          <Button size="sm" variant="primary" disabled={!valid} onClick={() => { onAdd({ id: `ov-${Date.now()}`, ...f, person: f.person.trim(), reason: f.reason.trim() }); onOpenChange(false); setF({ ...f, person: '', reason: '' }); }}>Add override</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

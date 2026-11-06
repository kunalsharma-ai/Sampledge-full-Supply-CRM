'use client';
/**
 * Screen 41 · System Settings. A searchable index of tenant settings in sections, with inline
 * validation and a change history. Edits are staged in a save bar. Risky settings (marked) show a
 * safe-mode preview of their impact before saving: reach for the fatigue cap, liability for the
 * points value, review load for auto-suspend. A setting that would break panellist consent terms
 * cannot be saved at all.
 * Live: values and history come from `GET /admin/settings`; Save sends one `PATCH /admin/settings`
 * (all changes or none), and the server writes an audit entry per change. Rules are shared with the API
 * (`settingError` in @sampledge/core). Settings managed elsewhere (Finance, the reward policy) are read-only here.
 */
import { History, Search, ShieldAlert, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Switch } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { InfoTip } from '@/components/supply/info-tip';
import { sectionHelp } from '@/lib/supply/help';
import { access, settingError } from '@/lib/core';
import { ApiError } from '@/lib/api';
import { useSupplyData } from '@/lib/supply/data';
import { loadSettings, saveSettings, type LiveSettings } from '@/lib/supply/live';
import { totals, funnel } from '@/lib/supply/demo';
import { liability } from '@/lib/supply/operations';
import { settingHistory, settings as seed, type ChangeEntry, type Setting } from '@/lib/supply/platform';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtMoney, fmtNum } from '@/lib/utils';

const screen = screenBySlug('settings')!;
type Val = Setting['value'];
const show = (s: Setting, v: Val) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : `${v}${s.unit && s.unit !== ':00' ? ` ${s.unit}` : s.unit ?? ''}`);
const totalPoints = liability.reduce((a, l) => a + l.points, 0);

function impact(s: Setting, from: Val, to: Val): string | null {
  if (s.id === 'send.weeklyCap') { const f = Number(from), t = Number(to); const reach = funnel[4].value * (1 + 0.06 * (t - f)); return `Reachable today goes from ${fmtNum(funnel[4].value)} to about ${fmtNum(Math.round(reach))}. Expect unsubscribes to move by ${((t - f) * 0.04).toFixed(2)} points a week.`; }
  if (s.id === 'rewards.pointValue') return `Outstanding liability is re-valued from ${fmtMoney(totalPoints / Number(from))} to ${fmtMoney(totalPoints / Number(to))}. Every member’s wallet shows a different dollar value.`;
  if (s.id === 'quality.autoSuspend' && to === true) return 'About 18 accounts a week would be suspended without review, based on the last 4 weeks of flags.';
  if (s.id === 'send.activeWithin') { const ratio = Math.min(1.6, Math.max(0.4, Math.sqrt(Number(to) / Number(from)))); return `Reachable today goes from ${fmtNum(funnel[4].value)} to about ${fmtNum(Math.round(funnel[4].value * ratio))}; older accounts respond less, so completes rise less than reach.`; }
  return null;
}

export default function Settings() {
  const toast = useOS((s) => s.toast);
  const [saved, setSaved] = useState<Record<string, Val>>(() => Object.fromEntries(seed.map((s) => [s.id, s.value])));
  const [draft, setDraft] = useState(saved);
  const [q, setQ] = useState('');
  const [history, setHistory] = useState<ChangeEntry[]>(settingHistory);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const live = useSupplyData<LiveSettings | null>('settings', () => null, loadSettings);
  const isLive = live.source === 'live' && !!live.data;
  const managed = isLive ? live.data!.managed : {};
  const role = useOS((s) => s.session?.role);
  const canEdit = !isLive || (!!role && access(role, 'admin') === 'full');
  useEffect(() => {
    if (!isLive) return;
    const v = live.data!.values;
    setSaved(v); setDraft(v);
    setHistory(live.data!.history.map((h) => {
      const s = seed.find((x) => x.id === h.setting);
      return { id: h.id, at: new Date(h.at).toLocaleString(), who: h.who, setting: s?.label ?? h.setting, from: h.from == null ? '—' : s ? show(s, h.from) : String(h.from), to: h.to == null ? '—' : s ? show(s, h.to) : String(h.to) };
    }));
  }, [isLive, live.data]);

  const shown = useMemo(() => seed.filter((s) => !q || `${s.label} ${s.help} ${s.section}`.toLowerCase().includes(q.toLowerCase())), [q]);
  const sections = [...new Set(seed.map((s) => s.section))];
  const changed = seed.filter((s) => draft[s.id] !== saved[s.id]);
  const errOf = (s: Setting): string | null => {
    const v = draft[s.id];
    if (managed[s.id] || v === saved[s.id]) return s.id === 'send.windowEnd' && draft['send.windowStart'] !== saved['send.windowStart'] ? settingError(s.id, v, draft) : null;
    return settingError(s.id, v, draft);
  };
  const errors = changed.map(errOf).filter(Boolean);
  const risky = changed.filter((s) => s.risky);
  const set = (id: string, v: Val) => setDraft((d) => ({ ...d, [id]: v }));
  const commit = async () => {
    if (isLive) {
      setSaving(true);
      try {
        const r = await saveSettings(Object.fromEntries(changed.map((s) => [s.id, draft[s.id]])));
        setSaved(r.values); setDraft(r.values); live.reload();
        toast(`Saved ${r.changed} setting${r.changed === 1 ? '' : 's'}`, 'ok');
      } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save the settings', 'warn'); }
      finally { setSaving(false); }
      return;
    }
    const at = '2026-11-06 ' + new Date().toTimeString().slice(0, 5);
    setHistory((h) => [...changed.map((s, i) => ({ id: `n${Date.now()}${i}`, at, who: 'You', setting: s.label, from: show(s, saved[s.id]), to: show(s, draft[s.id]) })), ...h]);
    setSaved(draft); toast(`Saved ${changed.length} setting${changed.length > 1 ? 's' : ''}`, 'ok');
  };

  return (
    <div className="space-y-4 pb-16">
      <SupplyHeader screen={screen} source={isLive ? 'live' : 'demo'} title="System settings" subtitle={`Workspace-wide rules for ${isLive ? 'every member' : `${fmtNum(totals.members)} members`} across three panels. Settings marked with a shield change behaviour for everyone; you see the impact before saving.${canEdit ? '' : ' You can read these settings; a platform admin changes them.'}`} />

      <div className="grid gap-4 lg:grid-cols-[200px_1fr_300px]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-4 lg:self-start">
          <div className="relative mb-2"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden /><input aria-label="Search settings" className={cn(inputCls, 'pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" /></div>
          <ul className="space-y-0.5">{sections.map((sec) => { const n = shown.filter((s) => s.section === sec).length; return <li key={sec}><a href={`#sec-${sec}`} className={cn('flex min-h-8 items-center justify-between rounded-lg px-2.5 text-[12.5px] hover:bg-surface-2/60', !n && 'pointer-events-none opacity-40')}>{sec}<span className="num text-2xs text-ink-3">{n}</span></a></li>; })}</ul>
        </nav>

        <div className="min-w-0 space-y-4">
          {sections.map((sec) => {
            const items = shown.filter((s) => s.section === sec);
            if (!items.length) return null;
            return (
              <Panel key={sec} className="p-4" aria-labelledby={`sec-${sec}`}>
                <h2 id={`sec-${sec}`} className="mb-2 flex scroll-mt-4 items-center gap-1 font-display text-[15px] font-semibold">{sec}<InfoTip entry={sectionHelp('settings', sec)} label={`${sec} settings`} /></h2>
                <ul className="divide-y divide-ink-3/15">
                  {items.map((s) => {
                    const v = draft[s.id], dirty = v !== saved[s.id], err = errOf(s), imp = dirty && s.risky ? (isLive ? null : impact(s, saved[s.id], v)) : null;
                    const id = `set-${s.id}`;
                    return (
                      <li key={s.id} className={cn('grid gap-2 py-3 sm:grid-cols-[1fr_200px] sm:items-start', dirty && 'rounded-lg bg-warn/[.06] px-2')}>
                        <div>
                          <label htmlFor={id} className="text-[13px] font-medium">{s.label}{s.risky && <ShieldAlert size={12} className="ml-1 inline text-warn" aria-label="Changes behaviour for everyone" />}{dirty && <Badge tone="warn" className="ml-2">Unsaved</Badge>}</label>
                          <p className="text-2xs text-ink-3">{s.help}</p>
                          {dirty && s.risky && <p className="mt-1.5 flex gap-1.5 rounded-lg bg-surface-2/60 px-2 py-1.5 text-[12px]"><TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span><b>{imp ? 'Preview' : 'Impact'}:</b> {imp ? `${imp} ` : ''}{s.risky}</span></p>}
                        </div>
                        <div>
                          {managed[s.id] || !canEdit ? <div className="text-[13px]"><span className="num font-semibold">{show(s, v)}</span>{managed[s.id] && <a href={managed[s.id].href} className="mt-0.5 block text-2xs text-primary hover:underline">Managed in {managed[s.id].label}</a>}</div>
                            : s.kind === 'toggle' ? <Switch id={id} checked={!!v} label={s.label} onCheckedChange={(x) => set(s.id, x)} />
                            : s.kind === 'select' ? <select id={id} className={inputCls} value={String(v)} onChange={(e) => set(s.id, e.target.value)}>{s.options!.map((o) => <option key={o}>{o}</option>)}</select>
                            : <div className="flex items-center gap-1.5"><input id={id} type={s.kind === 'number' ? 'number' : 'text'} step={s.kind === 'number' && Number(s.max) <= 1 ? 0.05 : 1} className={inputCls} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} value={String(v)} onChange={(e) => set(s.id, s.kind === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />{s.unit && <span className="shrink-0 text-2xs text-ink-3">{s.unit}</span>}</div>}
                          {err && <p id={`${id}-err`} className="mt-1 text-2xs text-danger" role="alert">{err}</p>}
                          {dirty && <button className="mt-1 text-2xs text-ink-3 underline" onClick={() => set(s.id, saved[s.id])}>Reset to {show(s, saved[s.id])}</button>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            );
          })}
          {shown.length === 0 && <Panel className="py-12 text-center text-[13px] text-ink-3">No setting matches “{q}”.</Panel>}
        </div>

        <Panel className="p-4 lg:sticky lg:top-4 lg:self-start">
          <SectionTitle eyebrow="Audit" title={<span className="flex items-center gap-1.5"><History size={14} aria-hidden /> Change history</span>} />
          {history.length === 0 && <p className="text-[12px] text-ink-3">No changes yet. Each save is recorded here and in the audit log.</p>}
          <ol className="space-y-2.5">{history.slice(0, 10).map((h) => <li key={h.id} className="text-[12px]"><div className="font-medium">{h.setting}</div><div className="text-ink-2"><span className="line-through opacity-70">{h.from}</span> → {h.to}</div><div className="text-2xs text-ink-3">{h.who} · {h.at}</div></li>)}</ol>
        </Panel>
      </div>

      <AnimatePresence>
        {changed.length > 0 && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} role="region" aria-label="Unsaved changes"
            className="panel fixed bottom-4 left-1/2 z-30 flex w-[min(640px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 px-4 py-3 shadow-lift">
            <span className="text-[13px]"><b>{changed.length}</b> unsaved change{changed.length > 1 ? 's' : ''}{risky.length ? <span className="text-warn"> · {risky.length} with wide impact</span> : ''}{errors.length ? <span className="text-danger"> · {errors.length} to fix</span> : ''}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDraft(saved)}>Discard</Button>
            <Button size="sm" variant="primary" disabled={errors.length > 0 || saving} onClick={() => (risky.length ? setConfirm(true) : commit())}>Save</Button>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="primary" title="Save settings with wide impact?"
        body={<ul className="space-y-2">{risky.map((s) => <li key={s.id}><b>{s.label}</b>: {show(s, saved[s.id])} → {show(s, draft[s.id])}<br /><span className="text-ink-3">{(isLive ? null : impact(s, saved[s.id], draft[s.id])) ?? s.risky}</span></li>)}</ul>}
        confirmLabel="Save" onConfirm={commit} />
    </div>
  );
}

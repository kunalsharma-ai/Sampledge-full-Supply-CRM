'use client';
/**
 * Screen 30 · Notification Center. Three priority lanes (Act, Review, FYI) aimed at inbox zero:
 * each item has its own action, Done, and Snooze. Done items can be undone from the toast bar.
 * Below, delivery rules decide which sources reach which channel, and which go to the daily
 * digest instead; the rules persist per user.
 * Integration: `GET /notifications` and `PATCH /notifications/:id` (planned); rules in user prefs.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { AlarmClock, Check, Inbox, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Panel, buttonVariants } from '@/components/ui/primitives';
import { Menu, MenuContent, MenuItem, MenuTrigger, Switch } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { channels, deliveryRules, notices, type Lane, type Notice } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn } from '@/lib/utils';

const screen = screenBySlug('notifications')!;
const lanes: { id: Lane; label: string; hint: string; tone: string }[] = [
  { id: 'act', label: 'Act', hint: 'Needs a decision from you', tone: 'bg-danger' },
  { id: 'review', label: 'Review', hint: 'Someone is waiting on a look', tone: 'bg-warn' },
  { id: 'fyi', label: 'FYI', hint: 'Good to know, nothing to do', tone: 'bg-ink-3' },
];
type Rules = typeof deliveryRules;

export default function Notifications() {
  const toast = useOS((s) => s.toast);
  const saved = useOS((s) => s.prefs['notify:rules'] as Rules | undefined);
  const setPref = useOS((s) => s.setPref);
  const rules = saved ?? deliveryRules;
  const [done, setDone] = useState<string[]>([]);
  const [snoozed, setSnoozed] = useState<Record<string, string>>({});
  const open = useMemo(() => notices.filter((n) => !done.includes(n.id) && !snoozed[n.id]), [done, snoozed]);
  const lastDone = done[done.length - 1];

  const markDone = (n: Notice) => { setDone((d) => [...d, n.id]); };
  const snooze = (n: Notice, until: string) => { setSnoozed((s) => ({ ...s, [n.id]: until })); toast(`Snoozed until ${until}`, 'info'); };
  const setRule = (i: number, patch: Partial<Rules[number]>) => setPref('notify:rules', rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Notifications" subtitle="Everything that needs you, sorted by what it asks of you. Clear the Act lane first."
        actions={<>
          {lastDone && <Button size="sm" variant="ghost" onClick={() => setDone((d) => d.slice(0, -1))}><Undo2 size={13} /> Undo done</Button>}
          <Badge tone={open.length ? 'blue' : 'emerald'}>{open.length} open</Badge>
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        {lanes.map((l) => {
          const items = open.filter((n) => n.lane === l.id);
          return (
            <Panel key={l.id} className="p-3">
              <header className="mb-2 flex items-center gap-2 px-1">
                <span className={cn('h-2.5 w-2.5 rounded-full', l.tone)} aria-hidden />
                <h2 className="font-display text-[15px] font-semibold">{l.label}</h2><span className="num text-2xs text-ink-3">{items.length}</span>
                <span className="ml-auto text-2xs text-ink-3">{l.hint}</span>
              </header>
              <ul className="space-y-2" aria-label={`${l.label} notifications`}>
                <AnimatePresence initial={false}>
                  {items.map((n) => (
                    <motion.li key={n.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, height: 0, marginTop: 0 }} transition={{ duration: 0.2 }}
                      className="rounded-xl border hairline bg-surface-2/30 p-3">
                      <div className="flex items-center gap-2 text-2xs text-ink-3"><span className="font-semibold text-ink-2">{n.source}</span><span>·</span><span>{n.at}</span></div>
                      <div className="mt-1 text-[13px] font-semibold leading-snug">{n.title}</div>
                      <div className="mt-0.5 text-[12px] text-ink-2">{n.detail}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {n.href && <Link href={n.href} className={buttonVariants({ size: 'xs', variant: l.id === 'act' ? 'primary' : 'ghost' })}>{n.action ?? 'Open'}</Link>}
                        <Button size="xs" variant="ghost" onClick={() => markDone(n)}><Check size={12} /> Done</Button>
                        <Menu>
                          <MenuTrigger asChild><Button size="xs" variant="ghost"><AlarmClock size={12} /> Snooze</Button></MenuTrigger>
                          <MenuContent align="start">{['in 1 hour', 'tomorrow 09:00', 'next Monday'].map((u) => <MenuItem key={u} onSelect={() => snooze(n, u)}>{u}</MenuItem>)}</MenuContent>
                        </Menu>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
                {items.length === 0 && <li className="grid place-items-center gap-1 py-8 text-center text-2xs text-ink-3"><Inbox size={20} />Nothing here.</li>}
              </ul>
            </Panel>
          );
        })}
      </div>

      {Object.keys(snoozed).length > 0 && (
        <p className="text-2xs text-ink-3">{Object.keys(snoozed).length} snoozed. <button className="font-semibold text-primary hover:underline" onClick={() => setSnoozed({})}>Bring them back</button></p>
      )}

      <Panel className="p-4">
        <SectionTitle eyebrow="Delivery rules" title="Where each kind of notification goes" actions={<Button size="xs" variant="ghost" onClick={() => setPref('notify:rules', undefined)}>Reset</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <caption className="sr-only">Notification channels per source</caption>
            <thead><tr className="text-left text-2xs text-ink-3"><th scope="col" className="py-1.5 font-semibold">Source</th>{channels.map((c) => <th key={c} scope="col" className="py-1.5 font-semibold">{c}</th>)}<th scope="col" className="py-1.5 font-semibold">Daily digest instead</th></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.source} className="border-t hairline">
                  <th scope="row" className="py-2 text-left font-medium">{r.source}</th>
                  {channels.map((c) => <td key={c}><Switch checked={r.channels[c]} label={`${r.source} by ${c}`} onCheckedChange={(v) => setRule(i, { channels: { ...r.channels, [c]: v } })} /></td>)}
                  <td><Switch checked={r.digest} label={`${r.source} in the daily digest`} onCheckedChange={(v) => setRule(i, { digest: v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-2xs text-ink-3">Act items always appear in the app, whatever the rule. Rules are saved to your profile.</p>
      </Panel>
    </div>
  );
}

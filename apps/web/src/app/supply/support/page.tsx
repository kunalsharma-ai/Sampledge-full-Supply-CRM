'use client';
/**
 * Screen 33 · Support Ticket Management. Three panes: the ticket list with live SLA timers, the
 * conversation with a reply box (macros, internal notes), and the member's context (profile,
 * recent points, quick actions). j/k move between tickets, r focuses the reply box.
 * Live: tickets are `ticket` records (`/supply/records/ticket`). A reply queues an e-mail to the
 * member through the Comms Hub (one recipient, transactional) and moves the ticket to waiting;
 * "From member" logs what the member wrote by e-mail, phone or chat; notes stay internal. Goodwill
 * points are a signed ledger adjustment with the ticket as the reason. The SLA counts from when the
 * ticket was opened (urgent 4 h, high 12 h, normal 24 h, low 72 h). AI drafts arrive with the copilot.
 */
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Clock3, ExternalLink, Lock, MessageSquareText, Plus, Send, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Field, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/overlay';
import { StatusPill, type Status } from '@/components/ui/status';
import { PanelChip, SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { ApiError } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { ago, loadMemberLedger, loadPanelistsByIds, records, searchPanelists, slaHours, type ApiPanelist, type LiveLedgerEntry, type Rec, type TicketData } from '@/lib/supply/live';
import { fromApiPanelist } from '@/lib/supply/panellists';
import { InfoTip } from '@/components/supply/info-tip';
import { sectionHelp } from '@/lib/supply/help';
import { ledger, macros, suggestions, tickets as seed, type Msg, type Ticket, type TicketStatus } from '@/lib/supply/operations';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('support')!;
const pill: Record<TicketStatus, Status> = { new: 'pending', open: 'active', waiting: 'paused', solved: 'completed' };
const prio: Record<Ticket['priority'], 'danger' | 'orange' | 'neutral'> = { urgent: 'danger', high: 'orange', normal: 'neutral', low: 'neutral' };
type LTicket = Ticket & { ref?: string; rec?: Rec<TicketData> };
const toTicket = (r: Rec<TicketData>, who: Map<string, ApiPanelist>): LTicket | null => {
  const p = who.get(r.data.panelistId);
  if (!p) return null;
  return {
    id: r.id, ref: r.ref, rec: r, subject: r.data.subject, category: r.data.category, status: r.status as TicketStatus, priority: r.data.priority, panellist: fromApiPanelist(p),
    slaMinutesLeft: Math.round((new Date(r.createdAt).getTime() + slaHours[r.data.priority] * 3600_000 - Date.now()) / 60_000),
    messages: (r.data.messages ?? []).map((m) => ({ ...m, at: ago(m.at) })), channel: (r.data.channel === 'Phone' ? 'Email' : r.data.channel) as Ticket['channel'],
  };
};
const transition: Partial<Record<TicketStatus, Partial<Record<TicketStatus, string>>>> = {
  new: { open: 'open', waiting: 'wait', solved: 'solve' }, open: { waiting: 'wait', solved: 'solve' }, waiting: { open: 'open', solved: 'solve' }, solved: { open: 'reopen' },
};
const sla = (m: number) => (m <= 0 ? 'Breached' : m < 60 ? `${m}m left` : `${Math.floor(m / 60)}h ${m % 60}m left`);

export default function Support() {
  const toast = useOS((s) => s.toast);
  const q = useSupplyData<LTicket[] | null>('support:tickets', () => null, async () => {
    const recs = await records.list<TicketData>('ticket');
    const who = new Map((await loadPanelistsByIds(recs.map((r) => r.data.panelistId))).map((p) => [p.id, p]));
    return recs.map((r) => toTicket(r, who)).filter((t): t is LTicket => !!t);
  });
  const live = q.source === 'live' && q.data ? q.data : null;
  const [demoList, setList] = useState(seed);
  const list: LTicket[] = live ?? demoList;
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [nt, setNt] = useState<{ subject: string; category: TicketData['category']; priority: TicketData['priority']; channel: TicketData['channel']; member: ApiPanelist | null; text: string }>({ subject: '', category: 'Rewards', priority: 'normal', channel: 'Email', member: null, text: '' });
  const [who, setWho] = useState('');
  const [found, setFound] = useState<ApiPanelist[]>([]);
  useEffect(() => {
    if (!live || who.trim().length < 2) { setFound([]); return; }
    let off = false;
    const t = setTimeout(() => searchPanelists(who.trim()).then((r) => { if (!off) setFound(r); }).catch(() => undefined), 250);
    return () => { off = true; clearTimeout(t); };
  }, [who, live]);
  const fail = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : `Could not ${what}`, 'warn');
  const [filter, setFilter] = useState<'mine' | 'all' | 'solved'>('all');
  const [selId, setSelId] = useState<string>(seed[0].id);
  const [mode, setMode0] = useState<'reply' | 'note' | 'member'>('reply');
  const [draft, setDraft] = useState('');
  const setMode = (m: 'reply' | 'note' | 'member') => setMode0(m);
  const [tick, setTick] = useState(0);
  const [grant, setGrant] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => list.filter((t) => (filter === 'solved' ? t.status === 'solved' : filter === 'mine' ? t.status === 'open' || t.status === 'waiting' : t.status !== 'solved')).sort((a, b) => a.slaMinutesLeft - b.slaMinutesLeft), [list, filter]);
  const cur = list.find((t) => t.id === selId) ?? rows[0];
  const ai = suggestions.find((s) => s.ticketId === cur?.id);
  const demoTx = useMemo(() => ledger.filter((t) => t.panellist.id === cur?.panellist.id).slice(0, 4), [cur]);
  const [liveTx, setLiveTx] = useState<LiveLedgerEntry[] | null>(null);
  useEffect(() => {
    if (!live || !cur) { setLiveTx(null); return; }
    let off = false;
    loadMemberLedger(cur.panellist.id).then((r) => { if (!off) setLiveTx(r); }).catch(() => { if (!off) setLiveTx([]); });
    return () => { off = true; };
  }, [live, cur?.panellist.id, cur?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentTx = live ? (liveTx ?? []).map((e) => ({ id: e.id, type: e.kind, at: ago(e.createdAt), points: e.points })) : demoTx.map((t) => ({ id: t.id, type: t.type, at: t.at, points: t.points }));
  const act = async (t: LTicket, action: string, extra: Record<string, unknown> = {}) => {
    if (!t.rec) return null;
    setBusy(true);
    try { const r = await records.act<TicketData>('ticket', t.rec, action, extra); q.reload(); return r; } catch (e) { fail(e, 'update the ticket'); return null; } finally { setBusy(false); }
  };
  const setStatus = async (t: LTicket, to: TicketStatus) => {
    if (!live) { patch(t.id, { status: to }); return; }
    const a = transition[t.status]?.[to];
    if (!a) { toast(`A ${t.status} ticket cannot go back to ${to}`, 'warn'); return; }
    if (await act(t, a)) toast(`${t.ref} is ${to}`, 'ok');
  };
  const create = async () => {
    if (!nt.member || nt.subject.trim().length < 3) return;
    setBusy(true);
    try {
      let r = await records.create<TicketData>('ticket', { subject: nt.subject.trim(), category: nt.category, priority: nt.priority, channel: nt.channel, panelistId: nt.member.id });
      if (nt.text.trim()) r = await records.act<TicketData>('ticket', r, 'member', { text: nt.text.trim() });
      q.reload(); setSelId(r.id); setNewOpen(false); setWho(''); setNt({ subject: '', category: 'Rewards', priority: 'normal', channel: 'Email', member: null, text: '' });
      toast(`${r.ref} opened for ${nt.member.handle}`, 'ok');
    } catch (e) { fail(e, 'open the ticket'); } finally { setBusy(false); }
  };
  const patch = (id: string, p: Partial<Ticket>) => setList((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const i = rows.findIndex((t) => t.id === cur?.id);
      if (e.key === 'j' && rows[i + 1]) setSelId(rows[i + 1].id);
      if (e.key === 'k' && rows[i - 1]) setSelId(rows[i - 1].id);
      if (e.key === 'r') { e.preventDefault(); box.current?.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const send = async (solve: boolean) => {
    if (!cur || !draft.trim()) return;
    if (live) {
      const r = await act(cur, mode === 'note' ? 'note' : mode === 'member' ? 'member' : solve ? 'reply_solve' : 'reply', { text: draft.trim() });
      if (r) { setDraft(''); toast(mode === 'note' ? 'Internal note added' : mode === 'member' ? 'Member message logged; the ticket is open' : solve ? `Replied by e-mail and solved ${r.ref}` : `Reply e-mailed to ${cur.panellist.handle}; waiting on the member`, 'ok'); }
      return;
    }
    const msg: Msg = { from: mode === 'note' ? 'note' : 'agent', author: mode === 'note' ? 'You' : 'You (Support)', text: draft.trim(), at: 'just now' };
    patch(cur.id, { messages: [...cur.messages, msg], status: mode === 'note' ? cur.status : solve ? 'solved' : 'waiting' });
    setDraft('');
    toast(mode === 'note' ? 'Internal note added' : solve ? `Replied and solved ${cur.id}` : `Reply sent; waiting on the member`, 'ok');
  };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={live ? 'live' : 'demo'} title="Support" subtitle="Member cases, oldest SLA first. The right-hand pane shows what you need to answer without leaving the ticket."
        actions={<>
          <span className="hidden items-center gap-1 text-2xs text-ink-3 sm:flex"><Kbd>j</Kbd><Kbd>k</Kbd> move · <Kbd>r</Kbd> reply</span>
          {live && <Button size="sm" onClick={() => setNewOpen(true)}><Plus size={13} /> New ticket</Button>}
        </>} />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_300px]">
        <Panel className="p-2">
          <div className="p-1.5"><Segmented label="Ticket filter" size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: `Open ${list.filter((t) => t.status !== 'solved').length}` }, { value: 'mine', label: 'Mine' }, { value: 'solved', label: 'Solved' }]} /></div>
          <ul className="space-y-1" aria-label="Tickets">
            {rows.map((t) => (
              <li key={t.id}>
                <button onClick={() => setSelId(t.id)} aria-current={t.id === cur?.id ? 'true' : undefined} className={cn('w-full rounded-lg px-2.5 py-2 text-left', t.id === cur?.id ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-2/50')}>
                  <span className="flex items-center gap-1.5 text-2xs text-ink-3"><span className="font-mono">{t.ref ?? t.id}</span><span>·</span><span>{t.category}</span>{t.priority !== 'normal' && t.priority !== 'low' && <Badge tone={prio[t.priority]} className="ml-auto">{t.priority}</Badge>}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] font-medium">{t.subject}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-2xs"><StatusPill status={pill[t.status]} label={t.status} />{t.status !== 'solved' && <span className={cn('num flex items-center gap-0.5', t.slaMinutesLeft - tick < 30 ? 'font-semibold text-danger' : 'text-ink-3')}><Clock3 size={10} />{sla(t.slaMinutesLeft - tick)}</span>}</span>
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="py-10 text-center text-2xs text-ink-3">{filter === 'mine' ? 'No tickets assigned to you.' : live ? 'No tickets here. Open one with “New ticket”.' : 'Nothing here.'}</li>}
          </ul>
        </Panel>

        {cur && (
          <Panel className="flex min-h-[560px] flex-col p-0">
            <div className="border-b hairline p-4">
              <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3"><span className="font-mono">{cur.ref ?? cur.id}</span><span>· {cur.rec?.data.channel ?? cur.channel}</span><StatusPill status={pill[cur.status]} label={cur.status} />
                <select aria-label="Ticket status" className={cn(inputCls, 'ml-auto h-7 w-28 py-0 text-2xs')} value={cur.status} disabled={busy} onChange={(e) => void setStatus(cur, e.target.value as TicketStatus)}>{(['new', 'open', 'waiting', 'solved'] as const).map((s) => <option key={s} disabled={!!live && s !== cur.status && !transition[cur.status]?.[s]}>{s}</option>)}</select>
              </div>
              <h2 className="mt-1 flex items-center gap-1 font-display text-[16px] font-semibold">{cur.subject}<InfoTip entry={sectionHelp('support', 'Selected ticket')} label="This ticket" /></h2>
            </div>
            <ol className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Conversation">
              <AnimatePresence initial={false}>
                {cur.messages.map((m, i) => (
                  <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px]', m.from === 'member' ? 'bg-surface-2/60' : m.from === 'agent' ? 'ml-auto bg-primary/12' : 'mx-auto max-w-full border border-dashed border-warn/50 bg-warn/[.07]')}>
                    <div className="mb-0.5 flex items-center gap-1.5 text-2xs text-ink-3">{m.from === 'note' && <Lock size={10} />}<b className="text-ink-2">{m.author}</b>· {m.at}{m.from === 'note' && ' · internal note'}</div>
                    <p className="leading-relaxed">{m.text}</p>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
            <div className="border-t hairline p-3">
              {!live && ai && cur.status !== 'solved' && (
                <button onClick={() => setDraft(ai.draft)} className="mb-2 flex w-full items-start gap-2 rounded-lg bg-purple/[.08] px-3 py-2 text-left text-2xs ring-1 ring-inset ring-purple/25 hover:bg-purple/[.12]">
                  <Sparkles size={13} className="mt-px shrink-0 text-purple" /><span><b className="text-ink">AI draft ready</b> ({Math.round(ai.confidence * 100)}% confidence). Click to insert, then edit before sending.</span>
                </button>
              )}
              <div className="mb-2 flex items-center gap-2">
                <Segmented label="Message type" size="sm" value={mode} onChange={setMode} options={[{ value: 'reply', label: 'Reply' }, { value: 'note', label: 'Internal note' }, ...(live ? [{ value: 'member' as const, label: 'From member' }] : [])]} />
                <Menu>
                  <MenuTrigger asChild><Button size="xs" variant="ghost"><MessageSquareText size={12} /> Macros</Button></MenuTrigger>
                  <MenuContent align="start"><MenuLabel>Insert a macro</MenuLabel>{macros.map((m) => <MenuItem key={m.id} onSelect={() => setDraft((d) => (d ? `${d}\n\n${m.text}` : m.text))}>{m.name}</MenuItem>)}</MenuContent>
                </Menu>
              </div>
              <textarea ref={box} aria-label={mode === 'note' ? 'Internal note' : mode === 'member' ? 'What the member wrote' : 'Reply to member'} rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className={cn(inputCls, 'h-auto py-2', mode === 'note' && 'border-warn/40 bg-warn/[.05]')} placeholder={mode === 'note' ? 'Only your team sees this.' : mode === 'member' ? `Paste what ${cur.panellist.handle} wrote by e-mail, phone or chat` : `Reply to ${cur.panellist.handle}…`} />
              <div className="mt-2 flex justify-end gap-1.5">
                {mode === 'reply' && <Button size="sm" variant="ghost" disabled={!draft.trim() || busy || cur.status === 'solved'} onClick={() => send(true)}>Send and solve</Button>}
                <Button size="sm" disabled={!draft.trim() || busy || (mode === 'reply' && !!live && cur.status === 'solved')} onClick={() => send(false)}><Send size={13} /> {mode === 'note' ? 'Add note' : mode === 'member' ? 'Log message' : 'Send'}</Button>
              </div>
            </div>
          </Panel>
        )}

        {cur && (
          <div className="space-y-4">
            <Panel className="p-4">
              <SectionTitle eyebrow="Member" title={cur.panellist.handle} actions={<PanelChip panel={cur.panellist.brand} short />} />
              <dl className="space-y-1 text-[12.5px]">
                {[['Country', cur.panellist.country], ['Member since', cur.panellist.joinedAt], ['Status', cur.panellist.status], ['Balance', `${fmtNum(cur.panellist.points)} pts`], ['Surveys done', cur.panellist.surveysCompleted], ['Quality', Math.round(cur.panellist.qualityScore * 100)]].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between"><dt className="text-ink-3">{k}</dt><dd className="num">{v}</dd></div>
                ))}
              </dl>
              {cur.panellist.risk.length > 0 && <Badge tone="danger" className="mt-2">Risk: {cur.panellist.risk.join(', ')}</Badge>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="xs" variant="ghost" disabled={cur.status === 'solved' && !!live} onClick={() => setGrant(true)}>Grant 50 points</Button>
                <Link href={`/supply/panellists/${cur.panellist.id}`} className="inline-flex items-center gap-1 px-2 text-2xs font-semibold text-primary hover:underline">360° profile <ExternalLink size={11} /></Link>
              </div>
            </Panel>
            <Panel className="p-4">
              <SectionTitle eyebrow="Points" title="Recent ledger rows" />
              {recentTx.length ? <ul className="space-y-1 text-[12px]">{recentTx.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="capitalize text-ink-2">{t.type}</span><span className="text-ink-3">{t.at}</span><span className="num font-semibold">{t.points > 0 ? '+' : ''}{fmtNum(t.points)}</span></li>)}</ul>
                : <p className="text-2xs text-ink-3">{live ? 'No ledger rows for this member yet.' : 'No ledger rows in the last 10 hours. Older history is on the 360° page.'}</p>}
            </Panel>
          </div>
        )}
      </div>

      <ConfirmDialog open={grant} onOpenChange={setGrant} tone="primary" title={`Grant 50 points to ${cur?.panellist.handle}?`} body="A goodwill adjustment is added to the ledger with this ticket as the reference. It cannot be deleted, only reversed by another adjustment."
        confirmLabel="Grant 50 points" onConfirm={() => { setGrant(false); if (cur && live) { void act(cur, 'goodwill', { points: 50 }).then((r) => r && toast(`50 points granted to ${cur.panellist.handle}`, 'ok')); return; } if (cur) { patch(cur.id, { messages: [...cur.messages, { from: 'note', author: 'You', text: 'Granted 50 goodwill points (ledger adjustment).', at: 'just now' }] }); toast('50 points granted', 'ok'); } }} />
      <ConfirmDialog open={newOpen} onOpenChange={setNewOpen} tone="primary" title="Open a support ticket" confirmLabel={busy ? 'Opening…' : 'Open ticket'}
        body={<div className="space-y-2.5">
          <Field label="Member (search by handle)"><input className={inputCls} value={nt.member ? nt.member.handle : who} onChange={(e) => { setNt({ ...nt, member: null }); setWho(e.target.value); }} placeholder="e.g. amber-otter" /></Field>
          {!nt.member && found.length > 0 && <ul className="max-h-36 overflow-y-auto rounded-lg border hairline" aria-label="Matching members">{found.map((m) => <li key={m.id}><button type="button" className="flex w-full justify-between px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2/50" onClick={() => setNt({ ...nt, member: m })}><span>{m.handle}</span><span className="text-2xs text-ink-3">{m.brand} · {m.country} · {m.status}</span></button></li>)}</ul>}
          <Field label="Subject"><input className={inputCls} value={nt.subject} maxLength={160} onChange={(e) => setNt({ ...nt, subject: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Category"><select className={inputCls} value={nt.category} onChange={(e) => setNt({ ...nt, category: e.target.value as TicketData['category'] })}>{(['Rewards', 'Survey issue', 'Account', 'Privacy', 'Technical'] as const).map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Priority"><select className={inputCls} value={nt.priority} onChange={(e) => setNt({ ...nt, priority: e.target.value as TicketData['priority'] })}>{(['urgent', 'high', 'normal', 'low'] as const).map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Channel"><select className={inputCls} value={nt.channel} onChange={(e) => setNt({ ...nt, channel: e.target.value as TicketData['channel'] })}>{(['Email', 'In app', 'Chat', 'Phone'] as const).map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <Field label="What the member wrote (optional)"><textarea rows={3} className={cn(inputCls, 'h-auto py-1.5')} value={nt.text} onChange={(e) => setNt({ ...nt, text: e.target.value })} /></Field>
          {(!nt.member || nt.subject.trim().length < 3) && <p className="text-2xs text-ink-3">Pick a member and write a subject of at least 3 characters.</p>}
        </div>}
        onConfirm={() => { if (nt.member && nt.subject.trim().length >= 3) void create(); else toast('Pick a member and write a subject first', 'warn'); }} />
    </div>
  );
}

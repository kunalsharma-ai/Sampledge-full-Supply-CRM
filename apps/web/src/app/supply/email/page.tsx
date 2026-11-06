'use client';
/**
 * Screen 27 · Email Campaign Designer. Three columns: block editor, live preview (desktop or
 * mobile width, in the panel's brand), and the send panel (audience with consent check, A/B
 * subject test, send time). Edits autosave as a draft; sending asks for confirmation because it
 * cannot be recalled.
 * Live: campaigns are `campaign` records (`/supply/records/campaign`). Drafts autosave there;
 * "Send" queues one Comms Hub message to the consent-filtered panel segment (held for the
 * high-volume approval above the threshold), and "Schedule" lets the scheduler send it at the
 * chosen time. The audience count comes from `GET /comms/preview`. A/B subject tests and per-member
 * send times are not in the live sender yet, so the screen says so instead of offering them.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, CalendarClock, Monitor, Plus, Send, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { AutosaveStatus, useAutosave, ValidatedInput } from '@/components/ui/forms';
import { Badge, Button, Field, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { ApiError } from '@/lib/api';
import { useOS } from '@/lib/store';
import { useSupplyData } from '@/lib/supply/data';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { opensByHour, starterBlocks, type EmailBlock } from '@/lib/supply/engagement';
import { apiBrand, brandFromApi, loadMessages, messageLabel, previewPanel, records, type CampaignData, type CommsPreview, type LiveMessage, type Rec } from '@/lib/supply/live';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('email')!;
const audiences = [
  { id: 'active-90', label: 'Active in the last 90 days', size: 412_000, consented: 0.97 },
  { id: 'dormant', label: 'Dormant 45+ days', size: 188_000, consented: 0.91 },
  { id: 'profile-gap', label: 'Profile under 60%', size: 96_000, consented: 0.95 },
  { id: 'hcp', label: 'Healthcare professionals', size: 31_500, consented: 0.99 },
];
const liveSegments: { id: CampaignData['segment']; label: string }[] = [
  { id: 'active', label: 'Active members' }, { id: 'dormant', label: 'Dormant members' }, { id: 'all', label: 'Active and dormant members' },
];
const statusLabel: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled' };
const kinds: EmailBlock['kind'][] = ['heading', 'text', 'button', 'image', 'survey', 'divider'];
const merge = (t: string, panel: string, first = 'Sam') => t.replaceAll('{{first_name}}', first).replaceAll('{{panel_name}}', panel);
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Preview({ blocks, brand, width, first }: { blocks: EmailBlock[]; brand: (typeof panelBrands)[number]; width: number; first?: string }) {
  const ink = `color-mix(in srgb, ${brand.color} 62%, black)`;
  return (
    <div className="mx-auto overflow-hidden rounded-xl bg-white text-[#1d2433] shadow-lift transition-[max-width] duration-300" style={{ maxWidth: width }}>
      <div className="flex items-center gap-2 px-5 py-3" style={{ background: ink, color: 'white' }}><span className="h-5 w-5 rounded-md bg-white/90" aria-hidden /><b className="text-[13px]">{brand.name}</b></div>
      <div className="space-y-3 px-5 py-4">
        {blocks.map((b) => {
          const t = merge(b.text, brand.name, first);
          if (b.kind === 'heading') return <h3 key={b.id} className="text-[18px] font-bold leading-snug">{t}</h3>;
          if (b.kind === 'text') return <p key={b.id} className="text-[13px] leading-relaxed text-[#46506a]">{t}</p>;
          if (b.kind === 'button') return <span key={b.id} className="inline-block rounded-lg px-4 py-2 text-[13px] font-semibold text-white" style={{ background: ink }}>{t}</span>;
          if (b.kind === 'image') return <div key={b.id} className="grid h-24 place-items-center rounded-lg text-[11px] text-[#5b6478]" style={{ background: `color-mix(in srgb, ${brand.color} 14%, white)` }}>{t}</div>;
          if (b.kind === 'survey') return <div key={b.id} className="rounded-lg border border-[#e4e7ef] p-3 text-[12px]"><b>{t}</b><div className="mt-1 flex gap-1.5">{[150, 150, 150].map((p, i) => <span key={i} className="rounded bg-[#f1f3f8] px-2 py-0.5">{p} pts</span>)}</div></div>;
          return <hr key={b.id} className="border-[#e4e7ef]" />;
        })}
      </div>
    </div>
  );
}

type Live = { campaigns: Rec<CampaignData>[]; messages: LiveMessage[] };

export default function EmailDesigner() {
  const toast = useOS((s) => s.toast);
  const isLive = useOS((s) => s.mode === 'live' && !!s.session);
  const q = useSupplyData<Live | null>('email:campaigns', () => null, async () => {
    const [campaigns, messages] = await Promise.all([records.list<CampaignData>('campaign'), loadMessages().catch(() => [] as LiveMessage[])]);
    return { campaigns, messages };
  });
  const live = q.source === 'live' && q.data ? q.data : null;

  const [panel, setPanel] = useState<PanelId>('t2o');
  const brand = panelBrands.find((b) => b.id === panel)!;
  const [name, setName] = useState('Weekly survey picks');
  const [blocks, setBlocks] = useState(starterBlocks);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [subjectA, setSubjectA] = useState('3 new surveys picked for you');
  const [subjectB, setSubjectB] = useState('');
  const [split, setSplit] = useState(20);
  const [aud, setAud] = useState(audiences[0].id);
  const [segment, setSegment] = useState<CampaignData['segment']>('active');
  const [timing, setTiming] = useState<'optimised' | 'fixed'>('optimised');
  const [hour, setHour] = useState(18);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [sendAt, setSendAt] = useState(() => localInput(new Date(Date.now() + 24 * 3600_000)));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── live record: which campaign is open, and what was last saved to it
  const [recId, setRecId] = useState<string | null>(null);
  const rec = live?.campaigns.find((c) => c.id === recId) ?? null;
  const recRef = useRef<Rec<CampaignData> | null>(null);
  recRef.current = rec;
  const savedJson = useRef('');
  const editable = !live || !rec || rec.status === 'draft' || rec.status === 'failed';
  const value = { name, brand: apiBrand[panel], segment, subjectA, blocks };
  const fail = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : `Could not ${what}`, 'warn');

  const open = (r: Rec<CampaignData> | null) => {
    setRecId(r?.id ?? null);
    if (!r) { savedJson.current = ''; return; }
    const d = r.data;
    setName(d.name); setPanel(brandFromApi[d.brand] ?? 't2o'); setSegment(d.segment ?? 'active'); setSubjectA(d.subjectA ?? ''); setSubjectB('');
    setBlocks(d.blocks?.length ? d.blocks : starterBlocks);
    savedJson.current = JSON.stringify({ name: d.name, brand: d.brand, segment: d.segment ?? 'active', subjectA: d.subjectA ?? '', blocks: d.blocks?.length ? d.blocks : starterBlocks });
  };
  // open the most recent draft when the live list first arrives
  const opened = useRef(false);
  useEffect(() => {
    if (!live || opened.current) return;
    opened.current = true;
    open(live.campaigns.find((c) => c.status === 'draft') ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const save = useAutosave(value, async (v) => {
    if (!live) { await new Promise((r) => setTimeout(r, 250)); return; }
    const json = JSON.stringify(v);
    if (json === savedJson.current || !editable) return;
    try {
      const cur = recRef.current;
      const r = cur ? await records.update<CampaignData>('campaign', cur, v) : await records.create<CampaignData>('campaign', v);
      savedJson.current = json;
      if (!cur) setRecId(r.id);
      q.reload();
    } catch (e) { fail(e, 'save the draft'); }
  }, editable);

  // ── audience: demo segments offline, consent-filtered counts from the Comms Hub live
  const [pv, setPv] = useState<CommsPreview | null>(null);
  useEffect(() => {
    if (!isLive) { setPv(null); return; }
    let off = false;
    previewPanel(apiBrand[panel], segment).then((p) => { if (!off) setPv(p); }).catch(() => { if (!off) setPv(null); });
    return () => { off = true; };
  }, [isLive, panel, segment]);
  const a = audiences.find((x) => x.id === aud)!;
  const sendable = live ? pv?.recipients ?? 0 : Math.round(a.size * a.consented);
  const bestHour = useMemo(() => opensByHour.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0), []);
  const subjectErr = (v: string) => (!v.trim() ? 'A subject is required' : v.length > 70 ? 'Over 70 characters gets cut off on most phones' : /free|\$\$\$|!!!/i.test(v) ? 'Words like this trip spam filters' : null);
  const issues = [subjectErr(subjectA), !live && subjectB && subjectErr(subjectB), !blocks.some((b) => b.kind === 'button') && 'Add a button so members can act', !blocks.some((b) => /email settings|unsubscribe/i.test(b.text)) && 'Add an unsubscribe or email-settings line',
    live && name.trim().length < 2 && 'Give the campaign a name', live && when === 'later' && !(new Date(sendAt).getTime() > Date.now()) && 'Pick a send time in the future', live && pv && pv.recipients === 0 && 'Nobody in this audience can receive e-mail'].filter(Boolean) as string[];

  const update = (id: string, text: string) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, text } : b)));
  const move = (i: number, d: -1 | 1) => setBlocks((bs) => { const n = [...bs]; const j = i + d; if (j < 0 || j >= n.length) return bs; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const msg = rec?.data.messageId ? live?.messages.find((m) => m.id === rec.data.messageId) : undefined;
  const sendLive = async () => {
    setBusy(true);
    try {
      let cur = recRef.current;
      const json = JSON.stringify(value);
      if (!cur) cur = await records.create<CampaignData>('campaign', value);
      else if (json !== savedJson.current) cur = await records.update<CampaignData>('campaign', cur, value);
      savedJson.current = json;
      const r = when === 'later'
        ? await records.act<CampaignData>('campaign', cur, 'schedule', { sendAt: new Date(sendAt).toISOString() })
        : await records.act<CampaignData>('campaign', cur, 'send');
      setRecId(r.id);
      q.reload();
      toast(r.status === 'scheduled' ? `${r.ref} will send ${new Date(r.data.sendAt!).toLocaleString()}` : r.data.needsApproval ? `${r.ref} is waiting for high-volume approval (${fmtNum(r.data.recipients ?? 0)} members)` : `${r.ref} queued to ${fmtNum(r.data.recipients ?? 0)} members`, 'ok');
    } catch (e) { fail(e, 'send the campaign'); } finally { setBusy(false); }
  };
  const act = async (action: 'unschedule' | 'cancel') => {
    if (!rec) return;
    try { const r = await records.act<CampaignData>('campaign', rec, action); q.reload(); toast(action === 'cancel' ? `${r.ref} cancelled` : `${r.ref} is a draft again`, 'ok'); } catch (e) { fail(e, 'change the campaign'); }
  };

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source={live ? 'live' : 'demo'} title="Email campaign designer" subtitle="Write the email, preview it in the panel’s brand, check the audience and consent, then schedule."
        actions={<>
          {editable && <AutosaveStatus state={save.state} savedAt={save.savedAt} />}
          {live && (
            <label className="flex items-center gap-2 text-2xs text-ink-3">Campaign
              <select className={cn(inputCls, 'h-8 w-56')} value={recId ?? ''} onChange={(e) => open(live.campaigns.find((c) => c.id === e.target.value) ?? null)}>
                <option value="">New campaign</option>
                {live.campaigns.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.title} ({statusLabel[c.status] ?? c.status})</option>)}
              </select>
            </label>
          )}
          <Segmented label="Panel brand" size="sm" value={panel} onChange={(v) => editable && setPanel(v)} options={panelBrands.map((b) => ({ value: b.id, label: b.short }))} />
          {editable && <Button size="sm" disabled={issues.length > 0 || busy} onClick={() => setConfirm(true)}>{live && when === 'later' ? <><CalendarClock size={13} /> Schedule</> : <><Send size={13} /> {live ? 'Send' : 'Schedule send'}</>}</Button>}
        </>} />

      {live && rec && !editable && (
        <Panel className="flex flex-wrap items-center gap-3 p-3 text-[12.5px]">
          <Badge tone={rec.status === 'sent' ? 'emerald' : rec.status === 'scheduled' ? 'blue' : 'neutral'}>{statusLabel[rec.status] ?? rec.status}</Badge>
          <span className="font-mono text-2xs text-ink-3">{rec.ref}</span>
          {rec.status === 'scheduled' && <span>Sends {new Date(rec.data.sendAt!).toLocaleString()}.</span>}
          {rec.status === 'sent' && <span>{fmtNum(rec.data.recipients ?? 0)} members · {msg ? messageLabel[msg.status] ?? msg.status : rec.data.needsApproval ? 'Awaiting approval' : 'Queued'}{msg?.error ? ` · ${msg.error}` : ''}</span>}
          <span className="text-2xs text-ink-3">{rec.status === 'scheduled' ? 'Make it a draft again to change it.' : 'A sent or cancelled campaign is kept as it was.'}</span>
          <span className="ml-auto flex gap-2">
            {rec.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => act('unschedule')}>Back to draft</Button>}
            {rec.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => act('cancel')}>Cancel</Button>}
            <Button size="sm" variant="ghost" onClick={() => open(null)}>New campaign</Button>
          </span>
        </Panel>
      )}
      {live && rec?.status === 'failed' && <Panel className="p-3 text-[12.5px] text-warn">The scheduled send failed: {rec.data.error}. Fix it and send or schedule again.</Panel>}

      <fieldset disabled={!editable} className="grid min-w-0 gap-4 xl:grid-cols-[300px_1fr_300px]">
        <legend className="sr-only">Campaign</legend>
        <Panel className="p-4">
          <SectionTitle eyebrow="Content" title={`${blocks.length} blocks`} />
          {live && <ValidatedInput label="Campaign name" value={name} onChange={setName} validate={(v) => (v.trim().length < 2 ? 'Give it a name your team will recognise' : null)} />}
          <ValidatedInput label="Subject line (A)" value={subjectA} onChange={setSubjectA} validate={subjectErr} hint={`${subjectA.length}/70`} />
          <ul className="mt-2 space-y-2">
            <AnimatePresence initial={false}>
              {blocks.map((b, i) => (
                <motion.li key={b.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="rounded-xl border hairline bg-surface-2/30 p-2">
                  <div className="mb-1 flex items-center gap-1">
                    <span className="eyebrow">{b.kind}</span>
                    <span className="ml-auto flex">
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${b.kind} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${b.kind} down`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${b.kind}`} onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}><Trash2 size={12} /></Button>
                    </span>
                  </div>
                  {b.kind !== 'divider' && (b.kind === 'text'
                    ? <textarea aria-label={`${b.kind} text`} rows={3} className={cn(inputCls, 'h-auto py-1.5 text-[12.5px]')} value={b.text} onChange={(e) => update(b.id, e.target.value)} />
                    : <input aria-label={`${b.kind} text`} className={cn(inputCls, 'h-8 text-[12.5px]')} value={b.text} onChange={(e) => update(b.id, e.target.value)} />)}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <div className="mt-2 flex flex-wrap gap-1">{kinds.map((k) => <Button key={k} size="xs" variant="ghost" className="border hairline" onClick={() => setBlocks((bs) => [...bs, { id: `b${Date.now()}`, kind: k, text: k === 'button' ? 'Take the survey' : k === 'heading' ? 'New heading' : k === 'divider' ? '' : 'New text' }])}><Plus size={11} /> {k}</Button>)}</div>
          <p className="mt-2 text-2xs text-ink-3">Merge fields: <code>{'{{first_name}}'}</code>, <code>{'{{panel_name}}'}</code>{live && '. Members are pseudonymous here, so {{first_name}} is sent as “there”.'}</p>
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Live preview" title={<span className="text-ink-2">Subject: <span className="text-ink">{subjectA || '—'}</span></span>}
            actions={<Segmented label="Preview width" size="sm" value={device} onChange={setDevice} options={[{ value: 'desktop', label: <span className="flex items-center gap-1"><Monitor size={12} /> Desktop</span> }, { value: 'mobile', label: <span className="flex items-center gap-1"><Smartphone size={12} /> Mobile</span> }]} />} />
          <div className="rounded-2xl bg-surface-2/40 p-4"><Preview blocks={blocks} brand={brand} width={device === 'desktop' ? 600 : 360} first={live ? 'there' : 'Sam'} /></div>
          <p className="mt-2 text-2xs text-ink-3">{live ? 'This is what members get: the send is plain text built from these blocks, and images are left out until the delivery provider hosts them.' : 'Preview uses a sample member (“Sam”). Images load from the brand library when sent.'}</p>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="Audience" title={`${fmtNum(sendable)} will receive it`} />
            {live ? <>
              <Field label="Segment"><select className={inputCls} value={segment} onChange={(e) => setSegment(e.target.value as CampaignData['segment'])}>{liveSegments.map((x) => <option key={x.id} value={x.id}>{brand.short} · {x.label}</option>)}</select></Field>
              <p className="mt-2 rounded-lg bg-surface-2/40 p-2.5 text-2xs text-ink-2">Counted now by the Comms Hub: members who withdrew e-mail consent, and suspended members, are left out. {pv?.needsApproval ? `Over ${fmtNum(pv.threshold)} recipients, so a high-volume approval is needed before it goes.` : ''}</p>
            </> : <>
              <Field label="Segment"><select className={inputCls} value={aud} onChange={(e) => setAud(e.target.value)}>{audiences.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
              <div className="mt-2 rounded-lg bg-surface-2/40 p-2.5 text-2xs text-ink-2">
                <div className="flex justify-between"><span>In segment</span><b className="num text-ink">{fmtNum(a.size)}</b></div>
                <div className="flex justify-between"><span>Without email consent (excluded)</span><b className="num text-ink">{fmtNum(a.size - sendable)}</b></div>
              </div>
            </>}
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="A/B test" title={live ? 'Not in the live sender yet' : subjectB ? `${split}% get B` : 'Off'} />
            {live ? <p className="text-2xs text-ink-2">The live sender sends one subject line to everyone in the segment. Subject tests need the delivery provider to split the audience; until then, compare subjects across two campaigns.</p> : <>
              <ValidatedInput label="Subject line (B)" value={subjectB} onChange={setSubjectB} validate={(v) => (v ? subjectErr(v) : null)} placeholder="Leave empty to skip the test" />
              {subjectB && <label className="block text-2xs text-ink-3">Test group size: {split}% each, winner to the rest after 4 hours
                <input type="range" min={5} max={50} step={5} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--primary))]" /></label>}
            </>}
          </Panel>
          <Panel className="p-4">
            {live ? <>
              <SectionTitle eyebrow="Send time" title={when === 'now' ? 'As soon as it is sent' : new Date(sendAt).toLocaleString()} />
              <Segmented label="Send time" size="sm" value={when} onChange={setWhen} options={[{ value: 'now', label: 'Now' }, { value: 'later', label: 'At a set time' }]} />
              {when === 'later' && <Field label="Send at (your time)"><input type="datetime-local" className={cn(inputCls, 'mt-1')} value={sendAt} onChange={(e) => setSendAt(e.target.value)} /></Field>}
              <p className="mt-2 text-2xs text-ink-3">The scheduler checks once a minute. Sending at each member’s best hour needs open tracking from the delivery provider, which is not connected yet.</p>
            </> : <>
              <SectionTitle eyebrow="Send time" title={timing === 'optimised' ? 'Each member’s best hour' : `${String(hour).padStart(2, '0')}:00 local`} />
              <Segmented label="Send timing" size="sm" value={timing} onChange={setTiming} options={[{ value: 'optimised', label: 'Optimised' }, { value: 'fixed', label: 'Fixed hour' }]} />
              {timing === 'fixed' && <input aria-label="Send hour" type="range" min={6} max={22} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-2 w-full accent-[rgb(var(--primary))]" />}
              <EChart ariaLabel="Share of opens by local hour" height={120} deps={[timing, hour]} option={(t) => ({
                grid: { left: 4, right: 4, top: 10, bottom: 2, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (v) => `${(Number(v) * 100).toFixed(1)}%` },
                xAxis: { type: 'category', data: opensByHour.map((_, h) => `${h}`), ...axis(t, { axisLabel: { interval: 5, color: 'rgb(var(--ink-3))', fontSize: 10 } }) }, yAxis: { type: 'value', show: false },
                series: [{ type: 'bar', name: 'Opens', barWidth: '70%', data: opensByHour.map((v, h) => ({ value: v, itemStyle: { color: (timing === 'fixed' ? h === hour : h === bestHour) ? 'rgb(var(--chart-1))' : 'rgb(var(--ink-3) / .35)', borderRadius: [2, 2, 0, 0] } })) }],
              })} />
              <p className="text-2xs text-ink-3">Opens peak at {bestHour}:00 local. Optimised sends spread across each member’s own best hour.</p>
            </>}
          </Panel>
          {editable && issues.length > 0 && <Panel className="p-4"><SectionTitle eyebrow="Before sending" title={`${issues.length} to fix`} actions={<Badge tone="warn">Blocked</Badge>} /><ul className="space-y-1 text-2xs text-ink-2">{issues.map((x) => <li key={x}>• {x}</li>)}</ul></Panel>}
        </div>
      </fieldset>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="primary"
        title={live ? (when === 'later' ? `Schedule this email to ${fmtNum(sendable)} members?` : `Send this email to ${fmtNum(sendable)} members?`) : `Schedule this email to ${fmtNum(sendable)} members?`}
        body={live
          ? `${brand.name} · ${liveSegments.find((s) => s.id === segment)!.label.toLowerCase()}. ${when === 'later' ? `Sends ${new Date(sendAt).toLocaleString()}. ` : ''}${pv?.needsApproval ? 'It is held for a high-volume approval first. ' : ''}Once sent, an email cannot be recalled.`
          : `${brand.name} · “${a.label}”. ${subjectB ? `${split}% get subject A and ${split}% get subject B first; the winner goes to the rest. ` : ''}${timing === 'optimised' ? 'Sends at each member’s best hour over the next 24 hours.' : `Sends at ${hour}:00 in each member’s time zone.`} Once sent, an email cannot be recalled.`}
        confirmLabel={live ? (when === 'later' ? 'Schedule' : 'Send') : 'Schedule send'}
        onConfirm={() => { setConfirm(false); if (live) void sendLive(); else toast(`Email scheduled to ${fmtNum(sendable)} members`, 'ok'); }} />
    </div>
  );
}

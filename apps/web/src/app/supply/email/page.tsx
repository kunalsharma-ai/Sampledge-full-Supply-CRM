'use client';
/**
 * Screen 27 · Email Campaign Designer. Three columns: block editor, live preview (desktop or
 * mobile width, in the panel's brand), and the send panel (audience with consent check, A/B
 * subject test, send-time optimiser). Edits autosave as a draft; sending asks for confirmation
 * because it cannot be recalled.
 * Integration: drafts `PUT /communications/campaigns/:id`, send `POST /communications/campaigns/:id/send` (planned).
 */
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, Monitor, Plus, Send, Smartphone, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EChart, axis } from '@/components/charts/echart';
import { AutosaveStatus, useAutosave, ValidatedInput } from '@/components/ui/forms';
import { Badge, Button, Field, Panel, Segmented, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { panelBrands, type PanelId } from '@/lib/supply/demo';
import { opensByHour, starterBlocks, type EmailBlock } from '@/lib/supply/engagement';
import { screenBySlug } from '@/lib/supply/screens';
import { cn, fmtNum } from '@/lib/utils';

const screen = screenBySlug('email')!;
const audiences = [
  { id: 'active-90', label: 'Active in the last 90 days', size: 412_000, consented: 0.97 },
  { id: 'dormant', label: 'Dormant 45+ days', size: 188_000, consented: 0.91 },
  { id: 'profile-gap', label: 'Profile under 60%', size: 96_000, consented: 0.95 },
  { id: 'hcp', label: 'Healthcare professionals', size: 31_500, consented: 0.99 },
];
const kinds: EmailBlock['kind'][] = ['heading', 'text', 'button', 'image', 'survey', 'divider'];
const merge = (t: string, panel: string) => t.replaceAll('{{first_name}}', 'Sam').replaceAll('{{panel_name}}', panel);

function Preview({ blocks, brand, width }: { blocks: EmailBlock[]; brand: (typeof panelBrands)[number]; width: number }) {
  const ink = `color-mix(in srgb, ${brand.color} 62%, black)`;
  return (
    <div className="mx-auto overflow-hidden rounded-xl bg-white text-[#1d2433] shadow-lift transition-[max-width] duration-300" style={{ maxWidth: width }}>
      <div className="flex items-center gap-2 px-5 py-3" style={{ background: ink, color: 'white' }}><span className="h-5 w-5 rounded-md bg-white/90" aria-hidden /><b className="text-[13px]">{brand.name}</b></div>
      <div className="space-y-3 px-5 py-4">
        {blocks.map((b) => {
          const t = merge(b.text, brand.name);
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

export default function EmailDesigner() {
  const toast = useOS((s) => s.toast);
  const [panel, setPanel] = useState<PanelId>('t2o');
  const brand = panelBrands.find((b) => b.id === panel)!;
  const [blocks, setBlocks] = useState(starterBlocks);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [subjectA, setSubjectA] = useState('3 new surveys picked for you');
  const [subjectB, setSubjectB] = useState('');
  const [split, setSplit] = useState(20);
  const [aud, setAud] = useState(audiences[0].id);
  const [timing, setTiming] = useState<'optimised' | 'fixed'>('optimised');
  const [hour, setHour] = useState(18);
  const [confirm, setConfirm] = useState(false);
  const save = useAutosave({ blocks, subjectA, subjectB, split, aud, panel }, () => new Promise((r) => setTimeout(r, 250)));
  const a = audiences.find((x) => x.id === aud)!;
  const sendable = Math.round(a.size * a.consented);
  const bestHour = useMemo(() => opensByHour.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0), []);
  const subjectErr = (v: string) => (!v.trim() ? 'A subject is required' : v.length > 70 ? 'Over 70 characters gets cut off on most phones' : /free|\$\$\$|!!!/i.test(v) ? 'Words like this trip spam filters' : null);
  const issues = [subjectErr(subjectA), subjectB && subjectErr(subjectB), !blocks.some((b) => b.kind === 'button') && 'Add a button so members can act', !blocks.some((b) => /email settings|unsubscribe/i.test(b.text)) && 'Add an unsubscribe or email-settings line'].filter(Boolean) as string[];

  const update = (id: string, text: string) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, text } : b)));
  const move = (i: number, d: -1 | 1) => setBlocks((bs) => { const n = [...bs]; const j = i + d; if (j < 0 || j >= n.length) return bs; [n[i], n[j]] = [n[j], n[i]]; return n; });

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} title="Email campaign designer" subtitle="Write the email, preview it in the panel’s brand, check the audience and consent, then schedule."
        actions={<>
          <AutosaveStatus state={save.state} savedAt={save.savedAt} />
          <Segmented label="Panel brand" size="sm" value={panel} onChange={setPanel} options={panelBrands.map((b) => ({ value: b.id, label: b.short }))} />
          <Button size="sm" disabled={issues.length > 0} onClick={() => setConfirm(true)}><Send size={13} /> Schedule send</Button>
        </>} />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_300px]">
        <Panel className="p-4">
          <SectionTitle eyebrow="Content" title={`${blocks.length} blocks`} />
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
          <p className="mt-2 text-2xs text-ink-3">Merge fields: <code>{'{{first_name}}'}</code>, <code>{'{{panel_name}}'}</code></p>
        </Panel>

        <Panel className="p-4">
          <SectionTitle eyebrow="Live preview" title={<span className="text-ink-2">Subject: <span className="text-ink">{subjectA || '—'}</span></span>}
            actions={<Segmented label="Preview width" size="sm" value={device} onChange={setDevice} options={[{ value: 'desktop', label: <span className="flex items-center gap-1"><Monitor size={12} /> Desktop</span> }, { value: 'mobile', label: <span className="flex items-center gap-1"><Smartphone size={12} /> Mobile</span> }]} />} />
          <div className="rounded-2xl bg-surface-2/40 p-4"><Preview blocks={blocks} brand={brand} width={device === 'desktop' ? 600 : 360} /></div>
          <p className="mt-2 text-2xs text-ink-3">Preview uses a sample member (“Sam”). Images load from the brand library when sent.</p>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="Audience" title={`${fmtNum(sendable)} will receive it`} />
            <Field label="Segment"><select className={inputCls} value={aud} onChange={(e) => setAud(e.target.value)}>{audiences.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
            <div className="mt-2 rounded-lg bg-surface-2/40 p-2.5 text-2xs text-ink-2">
              <div className="flex justify-between"><span>In segment</span><b className="num text-ink">{fmtNum(a.size)}</b></div>
              <div className="flex justify-between"><span>Without email consent (excluded)</span><b className="num text-ink">{fmtNum(a.size - sendable)}</b></div>
            </div>
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="A/B test" title={subjectB ? `${split}% get B` : 'Off'} />
            <ValidatedInput label="Subject line (B)" value={subjectB} onChange={setSubjectB} validate={(v) => (v ? subjectErr(v) : null)} placeholder="Leave empty to skip the test" />
            {subjectB && <label className="block text-2xs text-ink-3">Test group size: {split}% each, winner to the rest after 4 hours
              <input type="range" min={5} max={50} step={5} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="mt-1 w-full accent-[rgb(var(--primary))]" /></label>}
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="Send time" title={timing === 'optimised' ? 'Each member’s best hour' : `${String(hour).padStart(2, '0')}:00 local`} />
            <Segmented label="Send timing" size="sm" value={timing} onChange={setTiming} options={[{ value: 'optimised', label: 'Optimised' }, { value: 'fixed', label: 'Fixed hour' }]} />
            {timing === 'fixed' && <input aria-label="Send hour" type="range" min={6} max={22} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-2 w-full accent-[rgb(var(--primary))]" />}
            <EChart ariaLabel="Share of opens by local hour" height={120} deps={[timing, hour]} option={(t) => ({
              grid: { left: 4, right: 4, top: 10, bottom: 2, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (v) => `${(Number(v) * 100).toFixed(1)}%` },
              xAxis: { type: 'category', data: opensByHour.map((_, h) => `${h}`), ...axis(t, { axisLabel: { interval: 5, color: 'rgb(var(--ink-3))', fontSize: 10 } }) }, yAxis: { type: 'value', show: false },
              series: [{ type: 'bar', name: 'Opens', barWidth: '70%', data: opensByHour.map((v, h) => ({ value: v, itemStyle: { color: (timing === 'fixed' ? h === hour : h === bestHour) ? 'rgb(var(--chart-1))' : 'rgb(var(--ink-3) / .35)', borderRadius: [2, 2, 0, 0] } })) }],
            })} />
            <p className="text-2xs text-ink-3">Opens peak at {bestHour}:00 local. Optimised sends spread across each member’s own best hour.</p>
          </Panel>
          {issues.length > 0 && <Panel className="p-4"><SectionTitle eyebrow="Before sending" title={`${issues.length} to fix`} actions={<Badge tone="warn">Blocked</Badge>} /><ul className="space-y-1 text-2xs text-ink-2">{issues.map((x) => <li key={x}>• {x}</li>)}</ul></Panel>}
        </div>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="primary" title={`Schedule this email to ${fmtNum(sendable)} members?`}
        body={`${brand.name} · “${a.label}”. ${subjectB ? `${split}% get subject A and ${split}% get subject B first; the winner goes to the rest. ` : ''}${timing === 'optimised' ? 'Sends at each member’s best hour over the next 24 hours.' : `Sends at ${hour}:00 in each member’s time zone.`} Once sent, an email cannot be recalled.`}
        confirmLabel="Schedule send" onConfirm={() => { setConfirm(false); toast(`Email scheduled to ${fmtNum(sendable)} members`, 'ok'); }} />
    </div>
  );
}

'use client';
/**
 * Screens 10–12 · Profiling studios. Shared frame: attribute library on the left, question editor
 * with a live respondent preview in the middle, coverage and versions on the right. Each studio
 * adds the module its domain needs: B2B gets a job-title taxonomy mapper, Healthcare a specialty
 * ontology with credential status. Edits autosave as a draft; publishing creates a new version.
 */
import { Check, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Bar, Button, Panel, inputCls } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/overlay';
import { AutosaveStatus, useAutosave } from '@/components/ui/forms';
import { SectionTitle, SupplyHeader } from '@/components/supply/kit';
import { useOS } from '@/lib/store';
import { screenBySlug } from '@/lib/supply/screens';
import { brandColors } from '@/lib/supply/screens';
import { cn, rng } from '@/lib/utils';

type Q = { key: string; label: string; text: string; type: 'single' | 'multi' | 'number'; options: string[]; coverage: number; version: number };
type Section = { name: string; questions: Q[] };
const q = (key: string, label: string, text: string, options: string[], coverage: number, type: Q['type'] = 'single'): Q => ({ key, label, text, type, options, coverage, version: 1 + (key.length % 4) });

const libraries: Record<'demographic' | 'b2b' | 'healthcare', { slug: string; title: string; subtitle: string; brand: 't2o' | 'mfr' | 'mho'; sections: Section[] }> = {
  demographic: {
    slug: 'profiling/demographic', title: 'Demographic profiling', subtitle: 'Core questions every consumer member answers. Changes publish to all three panels.', brand: 't2o',
    sections: [
      { name: 'Household', questions: [q('hh_size', 'Household size', 'How many people live in your household, including you?', ['1', '2', '3', '4', '5+'], 0.71), q('kids', 'Children in home', 'Do any children under 18 live with you?', ['Yes', 'No', 'Prefer not to say'], 0.69), q('income', 'Household income', 'What is your total household income before tax?', ['Under 25k', '25–50k', '50–75k', '75–100k', '100–150k', '150k+', 'Prefer not to say'], 0.78)] },
      { name: 'About you', questions: [q('education', 'Education', 'What is the highest level of education you have completed?', ['Secondary', 'Vocational', 'Bachelor', 'Master', 'Doctorate'], 0.82), q('employment', 'Employment', 'Which best describes your employment status?', ['Full-time', 'Part-time', 'Self-employed', 'Student', 'Retired', 'Not working'], 0.84)] },
      { name: 'Lifestyle', questions: [q('vehicle', 'Vehicle ownership', 'Which of these vehicles does your household own?', ['Petrol car', 'Diesel car', 'Hybrid', 'Electric', 'Motorbike', 'None'], 0.55, 'multi'), q('media', 'Media habits', 'Which streaming services do you use at least monthly?', ['Netflix', 'Prime Video', 'Disney+', 'YouTube', 'Spotify', 'None'], 0.74, 'multi')] },
    ],
  },
  b2b: {
    slug: 'profiling/b2b', title: 'B2B profiling', subtitle: 'Job role, industry, company size and purchase authority for professional members.', brand: 'mfr',
    sections: [
      { name: 'Role', questions: [q('title', 'Job title', 'What is your job title?', [], 0.61, 'single'), q('seniority', 'Seniority', 'Which best describes your level?', ['Individual contributor', 'Manager', 'Director', 'VP', 'C-level', 'Owner'], 0.58), q('function', 'Function', 'Which department do you work in?', ['IT', 'Finance', 'Marketing', 'HR', 'Operations', 'Sales', 'Procurement'], 0.56)] },
      { name: 'Company', questions: [q('industry', 'Industry', 'Which industry is your organisation in?', ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Public sector'], 0.6), q('size', 'Company size', 'How many people work at your organisation?', ['1–9', '10–49', '50–249', '250–999', '1,000–4,999', '5,000+'], 0.53)] },
      { name: 'Authority', questions: [q('itdm', 'IT purchase role', 'What is your role in IT purchases?', ['Final decision', 'Influence', 'Evaluate', 'No role'], 0.44)] },
    ],
  },
  healthcare: {
    slug: 'profiling/healthcare', title: 'Healthcare profiling', subtitle: 'Specialties, practice details and conditions. Shown only to members who granted health-data consent.', brand: 'mho',
    sections: [
      { name: 'Professional', questions: [q('specialty', 'Specialty', 'What is your primary specialty?', ['Cardiology', 'Oncology', 'General practice', 'Nursing', 'Neurology', 'Dermatology', 'Endocrinology', 'Pharmacy'], 0.91), q('years', 'Years in practice', 'How many years have you practised since qualifying?', [], 0.87, 'number'), q('setting', 'Practice setting', 'Where do you mainly practise?', ['Hospital', 'Private clinic', 'Community', 'Academic'], 0.73)] },
      { name: 'Patient', questions: [q('conditions', 'Diagnosed conditions', 'Has a doctor ever told you that you have any of these conditions?', ['Type 2 diabetes', 'Hypertension', 'Asthma', 'Migraine', 'Arthritis', 'None of these'], 0.66, 'multi'), q('caregiver', 'Caregiver', 'Do you care for someone with a long-term condition?', ['Yes', 'No'], 0.6)] },
    ],
  },
};

export function ProfilingStudio({ kind }: { kind: keyof typeof libraries }) {
  const lib = libraries[kind];
  const screen = screenBySlug(lib.slug)!;
  const toast = useOS((s) => s.toast);
  const brand = brandColors[lib.brand];
  const ink = `color-mix(in srgb, ${brand.color} 62%, black)`; // AA on white for the preview
  const [sections, setSections] = useState(lib.sections);
  const [sel, setSel] = useState({ s: 0, q: 0 });
  const [publish, setPublish] = useState(false);
  const cur = sections[sel.s].questions[sel.q];
  const save = useAutosave(sections, () => undefined);
  const update = (patch: Partial<Q>) => setSections(sections.map((s, i) => (i !== sel.s ? s : { ...s, questions: s.questions.map((x, k) => (k === sel.q ? { ...x, ...patch } : x)) })));
  const r = useMemo(() => rng(cur.key.length * 97 + cur.key.charCodeAt(0)), [cur.key]);
  const coverage = useMemo(() => ['US', 'GB', 'DE', 'IN', 'CA', 'FR', 'BR', 'AU'].map((c) => [c, Math.min(0.98, cur.coverage + (r() - 0.5) * 0.3)] as const), [cur.key, cur.coverage, r]);
  const textErr = cur.text.trim().length < 10 ? 'Question text must be at least 10 characters' : !/[?.]$/.test(cur.text.trim()) ? 'End the question with ? or .' : null;
  const optErr = cur.type !== 'number' && cur.key !== 'title' && cur.options.filter((o) => o.trim()).length < 2 ? 'Add at least two answer options' : null;

  return (
    <div className="space-y-4">
      <SupplyHeader screen={screen} source="demo" title={lib.title} subtitle={lib.subtitle}
        actions={<><AutosaveStatus state={save.state} savedAt={save.savedAt} /><Button size="sm" variant="primary" disabled={!!textErr || !!optErr} onClick={() => setPublish(true)}>Publish v{cur.version + 1}</Button></>} />
      <div className="grid gap-4 xl:grid-cols-[260px_1fr_280px]">
        <Panel className="h-fit p-3">
          <SectionTitle eyebrow="Library" title="Attributes" />
          <nav aria-label="Profile attributes" className="space-y-3">
            {sections.map((s, si) => (
              <div key={s.name}>
                <div className="eyebrow mb-1 px-1">{s.name}</div>
                <ul className="space-y-0.5">
                  {s.questions.map((x, qi) => (
                    <li key={x.key}>
                      <button onClick={() => setSel({ s: si, q: qi })} aria-current={si === sel.s && qi === sel.q ? 'true' : undefined}
                        className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px]', si === sel.s && qi === sel.q ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-2/50')}>
                        <span className="flex-1 truncate">{x.label}</span>
                        <span className={cn('num text-2xs', x.coverage < 0.6 ? 'text-warn' : 'text-ink-3')}>{Math.round(x.coverage * 100)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow={`${cur.label} · v${cur.version} published`} title="Question" />
            <label className="block"><span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-ink-3">Text shown to members</span>
              <textarea value={cur.text} onChange={(e) => update({ text: e.target.value })} rows={2} aria-invalid={!!textErr || undefined}
                className={cn(inputCls, 'h-auto py-2')} />
              <span className={cn('mt-1 block text-2xs', textErr ? 'text-danger' : 'text-ink-3')} aria-live="polite">{textErr ?? `${cur.text.length} characters`}</span>
            </label>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="block"><span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-ink-3">Answer type</span>
                <select className={cn(inputCls, 'h-8 w-40 px-2')} value={cur.type} onChange={(e) => update({ type: e.target.value as Q['type'] })}><option value="single">Single choice</option><option value="multi">Multiple choice</option><option value="number">Number</option></select>
              </label>
            </div>
            {cur.type !== 'number' && cur.key !== 'title' && (
              <div className="mt-3">
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">Options</div>
                <ul className="space-y-1">
                  {cur.options.map((o, i) => (
                    <li key={i} className="flex items-center gap-1.5"><GripVertical size={13} className="text-ink-3" aria-hidden />
                      <input aria-label={`Option ${i + 1}`} value={o} onChange={(e) => update({ options: cur.options.map((x, k) => (k === i ? e.target.value : x)) })} className={cn(inputCls, 'h-8')} />
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove option ${o}`} onClick={() => update({ options: cur.options.filter((_, k) => k !== i) })}><Trash2 size={12} /></Button>
                    </li>
                  ))}
                </ul>
                <Button size="xs" variant="ghost" className="mt-1" onClick={() => update({ options: [...cur.options, ''] })}><Plus size={12} /> Option</Button>
                {optErr && <div className="mt-1 text-2xs text-danger" aria-live="polite">{optErr}</div>}
              </div>
            )}
          </Panel>

          {kind === 'b2b' && <TaxonomyMapper />}
          {kind === 'healthcare' && <SpecialtyOntology />}
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
            <SectionTitle eyebrow="Respondent preview" title={brand.name} />
            <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-[22px] border-4 border-ink-3/30 bg-white text-[#1a1f2e]">
              <div className="h-2" style={{ background: brand.color }} />
              <div className="space-y-2 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ink }}>About you · 30 points</div>
                <div className="text-[12.5px] font-semibold leading-snug">{cur.text || '…'}</div>
                {cur.type === 'number' || cur.key === 'title'
                  ? <div className="h-8 rounded-md border border-black/15" />
                  : cur.options.filter(Boolean).slice(0, 7).map((o) => <div key={o} className="flex items-center gap-2 rounded-md border border-black/10 px-2 py-1.5 text-[11.5px]"><span className={cn('h-3 w-3 border border-black/30', cur.type === 'multi' ? 'rounded-sm' : 'rounded-full')} />{o}</div>)}
                <div className="rounded-md py-1.5 text-center text-[11px] font-semibold text-white" style={{ background: ink }}>Next</div>
              </div>
            </div>
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="Coverage" title="Answered, by country" />
            <ul className="space-y-1.5">{coverage.map(([c, v]) => <li key={c} className="grid grid-cols-[28px_1fr_36px] items-center gap-2 text-[12px]"><span className="font-mono text-2xs text-ink-3">{c}</span><Bar value={v} tone={v < 0.6 ? 'orange' : 'emerald'} className="h-1.5" /><span className="num text-right text-2xs">{Math.round(v * 100)}%</span></li>)}</ul>
          </Panel>
          <Panel className="p-4">
            <SectionTitle eyebrow="History" title="Versions" />
            <ol className="space-y-1.5 text-[12px]">{Array.from({ length: cur.version }, (_, i) => cur.version - i).map((v) => <li key={v} className="flex justify-between"><span>v{v}{v === cur.version && <Badge tone="emerald" className="ml-1.5">live</Badge>}</span><span className="text-2xs text-ink-3">{['Nov 2', 'Sep 18', 'Jun 4', 'Feb 11'][cur.version - v] ?? '2025'}</span></li>)}</ol>
          </Panel>
        </div>
      </div>
      <ConfirmDialog open={publish} onOpenChange={setPublish} tone="primary" title={`Publish ${cur.label} v${cur.version + 1}?`} confirmLabel="Publish"
        body="Members see the new wording next time the question is asked. Existing answers are kept and mapped to the new options where labels match; unmatched answers are flagged for re-asking."
        onConfirm={() => { update({ version: cur.version + 1 }); toast(`${cur.label} v${cur.version + 1} published`); }} />
    </div>
  );
}

function TaxonomyMapper() {
  const toast = useOS((s) => s.toast);
  const [rows, setRows] = useState([
    ['Sr. Dir, Infra & Cloud Ops', 'IT decision maker', 'Director', 0.94], ['Head of FP&A', 'Finance leader', 'Director', 0.91], ['Growth Marketing Lead', 'Marketing leader', 'Manager', 0.82],
    ['People Partner II', 'HR leader', 'Individual contributor', 0.67], ['Founder / CEO (8 staff)', 'Small business owner', 'Owner', 0.97], ['SWE III (backend)', 'Software engineer', 'Individual contributor', 0.89], ['Category buyer', 'Procurement', 'Manager', 0.58],
  ] as [string, string, string, number][]);
  return (
    <Panel className="p-4">
      <SectionTitle eyebrow="Taxonomy mapper" title="Free-text job titles → normalised roles" actions={<Badge tone="purple">AI suggested</Badge>} />
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[12.5px]">
        <thead><tr className="text-left text-2xs uppercase tracking-wider text-ink-3"><th className="py-1.5">Raw title</th><th>Role</th><th>Seniority</th><th className="text-right">Confidence</th><th /></tr></thead>
        <tbody>{rows.map(([raw, role, sen, c]) => (
          <tr key={raw} className="h-row border-t hairline"><td className="font-mono text-2xs">{raw}</td><td>{role}</td><td className="text-ink-2">{sen}</td><td className={cn('num text-right', c < 0.7 ? 'text-warn' : 'text-ink-2')}>{Math.round(c * 100)}%</td>
            <td className="w-20 text-right"><Button size="icon-sm" variant="success" aria-label={`Accept mapping for ${raw}`} onClick={() => { setRows(rows.filter((x) => x[0] !== raw)); toast(`Mapped “${raw}” → ${role}`); }}><Check size={12} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Reject mapping for ${raw}`} onClick={() => { setRows(rows.filter((x) => x[0] !== raw)); toast('Sent to manual mapping', 'info'); }}><X size={12} /></Button></td></tr>
        ))}</tbody>
      </table></div>
      {rows.length === 0 && <p className="py-4 text-center text-[13px] text-ink-3">All suggestions reviewed.</p>}
    </Panel>
  );
}

function SpecialtyOntology() {
  const tree = [['Cardiology', ['Interventional', 'Electrophysiology', 'Heart failure']], ['Oncology', ['Medical', 'Radiation', 'Haematology']], ['Nursing', ['Oncology nursing', 'Critical care', 'Community']], ['Neurology', ['Stroke', 'Epilepsy', 'Movement disorders']]] as const;
  const creds = [['US', 'NPI registry', 0.93], ['GB', 'GMC / NMC register', 0.89], ['DE', 'Ärztekammer', 0.71], ['FR', 'RPPS', 0.78]] as const;
  return (
    <Panel className="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <SectionTitle eyebrow="Ontology" title="Specialties and sub-specialties" />
        <ul className="space-y-2 text-[12.5px]">{tree.map(([s, subs]) => <li key={s}><div className="font-medium">{s}</div><div className="mt-1 flex flex-wrap gap-1">{subs.map((x) => <span key={x} className="rounded-md bg-ink-3/12 px-1.5 py-0.5 text-2xs">{x}</span>)}</div></li>)}</ul>
      </div>
      <div>
        <SectionTitle eyebrow="Credentials" title="Registry checks by country" />
        <ul className="space-y-2">{creds.map(([c, reg, v]) => <li key={c} className="text-[12.5px]"><div className="flex justify-between"><span><span className="font-mono text-2xs text-ink-3">{c}</span> {reg}</span><span className="num">{Math.round(v * 100)}%</span></div><Bar value={v} tone={v < 0.8 ? 'orange' : 'emerald'} className="mt-1 h-1" /></li>)}</ul>
      </div>
    </Panel>
  );
}

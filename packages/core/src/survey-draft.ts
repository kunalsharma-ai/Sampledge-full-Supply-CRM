/**
 * The rule-based survey drafter: screening and profile questions for the audience, rotating driver
 * questions up to the target length, an attention check in the middle and one open end last. Used by
 * the demo screen and as the AI gateway's fallback for the `survey.draft` task.
 */
export type DraftBrief = { topic: string; audience: 'consumer' | 'b2b' | 'health'; goal: string; length: number };
export type DraftQuestion = { id: string; type: 'single' | 'multi' | 'scale' | 'open' | 'grid' | 'numeric'; text: string; options?: string[]; rationale: string; flags: string[] };
const topicBank: Record<string, { q: string; type: DraftQuestion['type']; options?: string[]; why: string }[]> = {
  b2b: [
    { q: 'Which best describes your role in buying {topic}?', type: 'single', options: ['I make the final decision', 'I recommend', 'I influence', 'Not involved'], why: 'Screens for decision authority, which drives eligibility for most B2B studies.' },
    { q: 'How many people work at your organisation?', type: 'single', options: ['1–49', '50–249', '250–999', '1,000+'], why: 'Company size is the most requested B2B quota.' },
    { q: 'Which industry is your organisation in?', type: 'single', options: ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Public sector', 'Other'], why: 'Maps to the B2B taxonomy so answers flow into targeting.' },
    { q: 'What is your annual budget for {topic}?', type: 'single', options: ['Under $10k', '$10k–$50k', '$50k–$250k', 'Over $250k', 'Don’t know'], why: 'Budget bands let clients size the opportunity; includes a “don’t know” escape.' },
  ],
  health: [
    { q: 'What is your primary specialty?', type: 'single', options: ['Cardiology', 'Oncology', 'General practice', 'Dermatology', 'Neurology', 'Other'], why: 'Specialty is required to route to almost every HCP study.' },
    { q: 'How many years have you been in practice?', type: 'numeric', why: 'Experience quotas are common; numeric keeps it precise.' },
    { q: 'Roughly how many patients with {topic} do you see in a typical month?', type: 'numeric', why: 'Patient volume is the strongest predictor of HCP survey incidence.' },
  ],
  consumer: [
    { q: 'How often do you use {topic}?', type: 'single', options: ['Every day', 'A few times a week', 'A few times a month', 'Rarely', 'Never'], why: 'Frequency splits heavy and light users for later targeting.' },
    { q: 'Which of these {topic} brands have you used in the last 3 months?', type: 'multi', options: ['Brand A', 'Brand B', 'Brand C', 'Brand D', 'None of these'], why: 'Brand usage is reusable profile data; “None” keeps it honest.' },
    { q: 'How satisfied are you with your current {topic}?', type: 'scale', options: ['1', '2', '3', '4', '5'], why: 'A 5-point scale is quick on mobile.' },
  ],
};
const common: { q: string; type: DraftQuestion['type']; options?: string[]; why: string }[] = [
  { q: 'Please select “Somewhat agree” for this question.', type: 'single', options: ['Strongly disagree', 'Somewhat disagree', 'Somewhat agree', 'Strongly agree'], why: 'Attention check. Failing it flags the response for quality review.' },
  { q: 'Is there anything else you would like to tell us about {topic}?', type: 'open', why: 'One open end at the end gives colour without raising drop-off.' },
];
const secs: Record<DraftQuestion['type'], number> = { single: 12, multi: 18, scale: 8, open: 45, grid: 40, numeric: 10 };
const drivers = ['price', 'quality', 'convenience', 'trust', 'speed', 'customer support', 'ease of use', 'recommendations from others'];
/** Screening and profile questions first, then rotating driver questions until the target length, an attention check in the middle and one open end last. */
/** Wording checks shown next to each drafted question, whoever drafted it. */
export function questionFlags(q: Pick<DraftQuestion, 'type' | 'text' | 'options'>): string[] {
  const flags: string[] = [];
  if (q.text.length > 90) flags.push('Long question text; may read poorly on mobile');
  if (q.type === 'multi' && !(q.options ?? []).some((o) => /none/i.test(o))) flags.push('Multi-select has no “None” option');
  if (/ and /i.test(q.text) && q.type === 'scale') flags.push('Possibly double-barrelled');
  if ((q.options?.length ?? 0) > 8) flags.push('More than 8 options; long lists read poorly on mobile');
  return flags;
}
/** Seconds a member typically spends on each question type (plus 1.5 s per option). */
export const draftSeconds = secs;
export function draftSurvey(brief: DraftBrief): DraftQuestion[] {
  const topic = brief.topic || 'this product';
  const raw = [...topicBank[brief.audience], ...(brief.audience !== 'consumer' ? topicBank.consumer.slice(0, 1) : [])];
  const cost = (t: { type: DraftQuestion['type']; options?: string[] }) => secs[t.type] + (t.options?.length ?? 0) * 1.5;
  const budget = brief.length * 60 - cost(common[0]) - cost(common[1]);
  let used = raw.reduce((a, t) => a + cost(t), 0);
  for (let k = 0; used < budget && k < drivers.length * 2; k++) {
    const t = { q: `How important is ${drivers[k % drivers.length]} when choosing {topic}?`, type: 'scale' as const, options: ['1', '2', '3', '4', '5'], why: 'Driver question; the set of drivers rotates so members do not see the same one twice in a row.' };
    raw.push(t); used += cost(t);
  }
  raw.splice(Math.ceil(raw.length / 2), 0, common[0]);
  raw.push(common[1]);
  return raw.map((t, i) => {
    const text = t.q.replaceAll('{topic}', topic);
    return { id: `Q${i + 1}`, type: t.type, text, options: t.options, rationale: t.why, flags: questionFlags({ type: t.type, text, options: t.options }) };
  });
}

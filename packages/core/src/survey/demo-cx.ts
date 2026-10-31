import type { Answers, SurveyDef } from './engine';

/**
 * DEMO questionnaire and SYNTHETIC responses for "CX Benchmark Telecom" (closed, fictional).
 * The responses are generated from fixed probabilities so Data Processing and Insight Studio have a
 * realistic dataset to weight, code and tabulate. They are not interviews with real people, and the
 * sample is deliberately skewed (more women, more under-35s) so weighting has work to do.
 */
export const cxSurvey: SurveyDef = {
  id: 'sv-012',
  name: 'CX Benchmark Telecom',
  version: 1,
  questions: [
    { id: 'S1', block: 'Profile', type: 'single', text: 'How do you describe your gender?', options: [{ code: 'f', label: 'Woman' }, { code: 'm', label: 'Man' }, { code: 'o', label: 'Another way' }] },
    { id: 'S2', block: 'Profile', type: 'single', text: 'Which age group are you in?', options: [{ code: 'a1', label: '18–34' }, { code: 'a2', label: '35–54' }, { code: 'a3', label: '55+' }] },
    { id: 'S3', block: 'Profile', type: 'single', text: 'Which region do you live in?', options: [{ code: 'n', label: 'North' }, { code: 's', label: 'South' }, { code: 'e', label: 'East' }, { code: 'w', label: 'West' }] },
    { id: 'Q1', block: 'Provider', type: 'single', text: 'Which mobile network is your main provider?', options: [{ code: 'p1', label: 'Network A' }, { code: 'p2', label: 'Network B' }, { code: 'p3', label: 'Network C' }, { code: 'p4', label: 'Another network' }] },
    { id: 'Q2', block: 'Provider', type: 'single', text: 'Overall, how satisfied are you with your provider?', options: [{ code: '5', label: 'Very satisfied' }, { code: '4', label: 'Satisfied' }, { code: '3', label: 'Neither' }, { code: '2', label: 'Dissatisfied' }, { code: '1', label: 'Very dissatisfied' }] },
    { id: 'Q3', block: 'Provider', type: 'multi', text: 'Which of these have you used in the last three months?', options: [{ code: 'app', label: 'Provider app' }, { code: 'chat', label: 'Online chat' }, { code: 'phone', label: 'Phone support' }, { code: 'store', label: 'Retail store' }, { code: 'none', label: 'None of these', exclusive: true }] },
    { id: 'Q4', block: 'Provider', type: 'numeric', min: 0, max: 300, text: 'Roughly how much do you pay per month, in dollars?' },
    { id: 'Q5', block: 'Advocacy', type: 'nps', min: 0, max: 10, text: 'How likely are you to recommend your provider to a friend?' },
    { id: 'Q6', block: 'Advocacy', type: 'text', text: 'What is the main reason for your score?' },
  ],
  rules: [],
  quotas: [],
};

function prng(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const choose = <T,>(r: () => number, items: [T, number][]) => { let x = r() * items.reduce((a, [, p]) => a + p, 0); for (const [v, p] of items) { x -= p; if (x <= 0) return v; } return items[items.length - 1][0]; };

const reasons: Record<'pro' | 'pas' | 'det', string[]> = {
  pro: ['Great coverage everywhere I go', 'Fast data speeds and good coverage', 'Customer service was really helpful', 'Good value for the price', 'The app makes everything easy', 'Never had a dropped call', 'Friendly staff in the store', 'Reliable network and fair price'],
  pas: ['It is fine, nothing special', 'Price is okay but coverage could be better', 'Decent service, a bit expensive', 'Coverage is good in the city but not at home', 'Average customer service', 'The app is fine but slow sometimes'],
  det: ['Too expensive for what you get', 'Calls drop all the time at home', 'Customer service kept me waiting for an hour', 'Hidden fees on my bill', 'Signal is terrible in my area', 'Price went up again without warning', 'Billing errors every month', 'Slow data speeds even with full signal'],
};

/** n synthetic completed interviews for cxSurvey, deterministic for a seed. */
export function cxResponses(n: number, seed = 42): { respondent: string; answers: Answers; minutes: number }[] {
  const r = prng(seed);
  return Array.from({ length: n }, (_, i) => {
    const S1 = choose(r, [['f', 0.62], ['m', 0.36], ['o', 0.02]]);
    const S2 = choose(r, [['a1', 0.48], ['a2', 0.34], ['a3', 0.18]]);
    const S3 = choose(r, [['n', 0.22], ['s', 0.31], ['e', 0.24], ['w', 0.23]]);
    const Q1 = choose(r, [['p1', 0.38], ['p2', 0.29], ['p3', 0.21], ['p4', 0.12]]);
    // Older respondents and Network A customers are a little happier; that is the story the data tells.
    const lift = (S2 === 'a3' ? 1.2 : S2 === 'a2' ? 0.5 : 0) + (Q1 === 'p1' ? 0.8 : Q1 === 'p3' ? -0.6 : 0);
    const nps = Math.max(0, Math.min(10, Math.round(6.4 + lift + (r() + r() + r() - 1.5) * 4)));
    const sat = String(Math.max(1, Math.min(5, Math.round(1 + nps / 2.5 + (r() - 0.5))))) as string;
    const used = ['app', 'chat', 'phone', 'store'].filter((c) => r() < ({ app: S2 === 'a1' ? 0.75 : 0.45, chat: 0.3, phone: S2 === 'a3' ? 0.45 : 0.22, store: 0.2 } as Record<string, number>)[c]);
    const kind = nps >= 9 ? 'pro' : nps >= 7 ? 'pas' : 'det';
    const list = reasons[kind];
    return {
      respondent: `syn-${String(i + 1).padStart(4, '0')}`,
      answers: { S1, S2, S3, Q1, Q2: sat, Q3: used.length ? used : ['none'], Q4: Math.round(18 + r() * 55 + (Q1 === 'p1' ? 8 : 0)), Q5: nps, Q6: list[Math.floor(r() * list.length)] },
      minutes: Math.round((4 + r() * 6) * 10) / 10,
    };
  });
}

/**
 * Rule-based extraction used when no AI model is connected (and as the baseline the AI gateway's
 * model output is checked against). Import-free so it runs in the browser, the API and tests.
 */

export type RfqFields = { n?: number; ir?: number; loi?: number; countries: string[]; audience?: 'B2C' | 'B2B' | 'Healthcare' };

/** RFQ e-mail text → structured requirements. `countryList` is code + name pairs. */
export function extractRfq(text: string, countryList: { code: string; name: string }[]): RfqFields {
  const t = text.toLowerCase();
  // "1,000 completes", "n=400", or a count followed by who they are ("200 IT decision makers").
  const who = 'people|adults|consumers|shoppers|users|customers|parents|nurses|physicians|doctors|oncologists|hcps|patients|caregivers|decision makers|itdms|managers|owners|executives|professionals';
  const nm = t.match(/(\d[\d,]*)\s*(?:completes|respondents|interviews|n\b)/) ?? t.match(/\bn\s*=\s*(\d[\d,]*)/) ?? t.match(new RegExp(`(\\d[\\d,]*)\\s+(?:[a-z-]+\\s+){0,3}?(?:${who})\\b`));
  const n = Number(nm?.[1]?.replace(/,/g, '')) || undefined;
  const ir = Number((t.match(/(\d{1,2})\s*%\s*(?:ir|incidence)/) ?? t.match(/(?:ir|incidence)[^\d]{0,12}(\d{1,2})\s*%/) ?? [])[1]) / 100 || undefined;
  const loi = Number((t.match(/(\d{1,2})\s*(?:-| )?(?:min|minute)/) ?? [])[1]) || undefined;
  // Codes match only in capitals, and never codes that double as words ("IT decision makers", "in Germany").
  const wordLike = new Set(['IT', 'IN', 'ID', 'NO', 'ME', 'AT', 'BE', 'IS', 'OR', 'TO', 'AM', 'AS', 'SO', 'GO', 'HE', 'MY', 'PA']);
  // Common short names: "the UK", "USA", "UAE", "Korea".
  const aliases: Record<string, RegExp> = { GB: /\b(?:UK|U\.K\.|Great Britain|Britain|England)\b/, US: /\b(?:USA|U\.S\.A?\.?)(?=\W|$)/, AE: /\bUAE\b/, KR: /(?<!North )\bKorea\b/ };
  const countries = countryList.filter((c) => t.includes(c.name.toLowerCase()) || (!wordLike.has(c.code) && new RegExp(`\\b${c.code}\\b`).test(text)) || !!aliases[c.code]?.test(text)).map((c) => c.code);
  const audience: RfqFields['audience'] = /hcp|physician|doctor|patient|oncolog|nurse|health/.test(t) ? 'Healthcare' : /b2b|decision.?maker|itdm|cio|it |manager|executive|smb|sme|business owner|small business/.test(t) ? 'B2B' : /consumer|gen pop|shopper|b2c|adults/.test(t) ? 'B2C' : undefined;
  return { n, ir, loi, countries, audience };
}

// ───────────────────────── Questionnaire text → structure
export type ParsedQuestion = { id: string; text: string; type: 'single' | 'multi' | 'numeric' | 'text' | 'nps' | 'matrix' | 'ranking'; options: { code: string; label: string; exclusive?: boolean }[]; notes: string[]; ambiguous: string[]; terminate?: string; displayIf?: string; randomize?: boolean };

export function parseQuestionnaire(src: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  let cur: ParsedQuestion | null = null;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const qm = line.match(/^([QS]\d+[a-z]?)[.):\s]+(.*)$/i);
    if (qm) {
      cur = { id: qm[1].toUpperCase(), text: qm[2].replace(/\[.*?\]/g, '').trim(), type: 'single', options: [], notes: [], ambiguous: [] };
      out.push(cur);
      const tags = [...qm[2].matchAll(/\[(.*?)\]/g)].map((m) => m[1]);
      tags.forEach((tag) => apply(cur!, tag));
      continue;
    }
    if (!cur) continue;
    const tag = line.match(/^\[(.*)\]$/);
    if (tag) { apply(cur, tag[1]); continue; }
    const om = line.match(/^(?:\d+|[a-z]|-|•)[.)\s]+(.*)$/i);
    if (om) {
      const label = om[1].replace(/\[.*?\]/g, '').trim();
      const exclusive = /none of|don.?t know|prefer not/i.test(label) || /\[exclusive\]/i.test(om[1]);
      const term = /\[(terminate|screen ?out)\]/i.test(om[1]);
      cur.options.push({ code: String(cur.options.length + 1), label, exclusive });
      if (term) cur.terminate = (cur.terminate ? cur.terminate + ',' : '') + String(cur.options.length);
      continue;
    }
    cur.ambiguous.push(`Unrecognised line: “${line.slice(0, 60)}”`);
  }
  out.forEach((q) => {
    if (!q.options.length && q.type === 'single') q.type = /how many|how old|number|percent|%|\bage\b/i.test(q.text) ? 'numeric' : 'text';
    if (/select all|all that apply/i.test(q.text)) q.type = 'multi';
    if (/recommend/i.test(q.text) && /0.?10|likely/i.test(q.text)) q.type = 'nps';
    if (q.type === 'single' && q.options.length === 1) q.ambiguous.push('Only one answer option found');
  });
  return out;
  function apply(q: ParsedQuestion, tag: string) {
    const t = tag.toLowerCase();
    if (/multi|select all/.test(t)) q.type = 'multi';
    else if (/numeric|number/.test(t)) q.type = 'numeric';
    else if (/open|text/.test(t)) q.type = 'text';
    else if (/grid|matrix/.test(t)) q.type = 'matrix';
    else if (/rank/.test(t)) q.type = 'ranking';
    if (/random|rotate/.test(t)) q.randomize = true;
    const ask = t.match(/ask (?:if|only if)\s+(.*)/);
    if (ask) q.displayIf = ask[1];
    if (/terminate|screen ?out/.test(t)) q.notes.push(`Termination: ${tag}`);
    if (/quota/.test(t)) q.notes.push(`Quota: ${tag}`);
    if (/pipe|insert/.test(t)) q.notes.push(`Piping: ${tag}`);
    if (/programmer|tbd|\?\?|check with client/.test(t)) q.ambiguous.push(`Needs clarification: ${tag}`);
  }
}


/**
 * Targeting criteria: structured filters on SUPPLY360 profile attributes (§4).
 * SAMPLEON builds them; SUPPLY360 evaluates them against its respondent master.
 */
import { z } from 'zod';

export const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

const scalar = z.union([z.string().max(200), z.number(), z.boolean()]);

export const Criterion = z.discriminatedUnion('op', [
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('eq'), value: scalar }),
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('in'), values: z.array(scalar).min(1).max(200) }),
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('nin'), values: z.array(scalar).min(1).max(200) }),
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('gte'), value: z.number() }),
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('lte'), value: z.number() }),
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('between'), min: z.number(), max: z.number() }),
  z.object({ attribute: z.string().regex(ATTRIBUTE_KEY), op: z.literal('exists') }),
]);
export type Criterion = z.infer<typeof Criterion>;
export const Criteria = z.array(Criterion).max(50);

export type AttributeType = 'enum' | 'number' | 'boolean' | 'string';
export interface AttributeDef {
  key: string;
  label: string;
  type: AttributeType;
  values?: string[];
  /** `health` attributes are evaluated only for respondents with health-data consent. */
  sensitivity: 'standard' | 'health';
  /** Words the natural-language parser may map to this attribute or its values. */
  synonyms?: Record<string, string[]>;
}

export type ProfileValue = string | number | boolean | null | undefined;
export type Profile = Record<string, ProfileValue>;

export interface Evaluation {
  eligible: boolean;
  /** Attributes the criteria need that the profile does not have. */
  missing: string[];
  /** Criteria that failed on a known value. */
  failed: string[];
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

/** Evaluate one profile. A missing attribute is "unknown", reported separately from a failure. */
export function evaluate(profile: Profile, criteria: Criterion[]): Evaluation {
  const missing: string[] = [];
  const failed: string[] = [];
  for (const c of criteria) {
    const v = profile[c.attribute];
    if (v === undefined || v === null || v === '') {
      missing.push(c.attribute);
      continue;
    }
    let ok: boolean;
    switch (c.op) {
      case 'exists': ok = true; break;
      case 'eq': ok = norm(v) === norm(c.value); break;
      case 'in': ok = c.values.some((x) => norm(x) === norm(v)); break;
      case 'nin': ok = !c.values.some((x) => norm(x) === norm(v)); break;
      case 'gte': ok = typeof v === 'number' && v >= c.value; break;
      case 'lte': ok = typeof v === 'number' && v <= c.value; break;
      case 'between': ok = typeof v === 'number' && v >= c.min && v <= c.max; break;
    }
    if (!ok) failed.push(c.attribute);
  }
  return { eligible: missing.length === 0 && failed.length === 0, missing, failed };
}

/** Check criteria against a catalogue; returns human-readable problems (empty = valid). */
export function checkAgainstCatalogue(criteria: Criterion[], catalogue: AttributeDef[]): string[] {
  const byKey = new Map(catalogue.map((a) => [a.key, a]));
  const problems: string[] = [];
  for (const c of criteria) {
    const def = byKey.get(c.attribute);
    if (!def) { problems.push(`Unknown attribute ${c.attribute}`); continue; }
    if ((c.op === 'gte' || c.op === 'lte' || c.op === 'between') && def.type !== 'number') problems.push(`${c.attribute} is not numeric`);
    if ((c.op === 'in' || c.op === 'nin') && def.type === 'enum' && def.values) {
      const bad = c.values.filter((v) => !def.values!.includes(String(v)));
      if (bad.length) problems.push(`${c.attribute} has no value ${bad.join(', ')}`);
    }
    if (c.op === 'eq' && def.type === 'enum' && def.values && !def.values.includes(String(c.value))) problems.push(`${c.attribute} has no value ${c.value}`);
  }
  return problems;
}

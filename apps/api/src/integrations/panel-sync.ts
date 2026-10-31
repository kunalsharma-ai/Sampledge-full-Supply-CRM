/**
 * Turns a Sampledge project and its quota cells into the panel's project sync body (PUT /project on
 * the panel's Sampledge routes). Pure functions, no network.
 *
 * Quota conditions in Sampledge refer to survey questions. Only conditions on the panel's built-in
 * profile fields (gender, age, region) translate automatically; anything else needs filters given
 * by a person, and the preview says which quotas those are. Nothing is guessed.
 */
import type { PanelFilter, PanelMarket, PanelProjectBody, PanelQuota } from './panel-backend';

type Cond =
  | { q: string; op: 'eq' | 'neq'; value: string }
  | { q: string; op: 'in' | 'nin'; values: string[] }
  | { q: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { q: string; op: 'answered' }
  | { all: Cond[] } | { any: Cond[] } | { not: Cond };

const FIELD: Record<string, 'gender' | 'age' | 'region'> = { gender: 'gender', sex: 'gender', age: 'age', region: 'region', state: 'region' };
const GENDER: Record<string, string> = { m: 'male', male: 'male', man: 'male', f: 'female', female: 'female', woman: 'female', other: 'other', o: 'other', x: 'other' };

/** Panel filters for a condition, or null when it cannot be expressed in the panel's fields. */
export function conditionToFilters(cond: unknown): PanelFilter[] | null {
  if (!cond || typeof cond !== 'object') return null;
  const c = cond as Cond;
  if ('all' in c) {
    const parts = c.all.map(conditionToFilters);
    if (parts.some((p) => p === null)) return null;
    // Two bounds on age merge into one range.
    const out: PanelFilter[] = [];
    for (const f of parts.flat() as PanelFilter[]) {
      const prev = out.find((o) => o.type === f.type);
      if (prev && f.type === 'age') prev.value = { ...(prev.value as object), ...(f.value as object) };
      else if (prev) return null; // the same field twice is ambiguous
      else out.push({ ...f });
    }
    return out;
  }
  if ('any' in c || 'not' in c) return null;
  const field = FIELD[String(c.q).toLowerCase()];
  if (!field) return null;
  if (field === 'age') {
    if (c.op === 'gte') return [{ type: 'age', value: { gte: c.value } }];
    if (c.op === 'gt') return [{ type: 'age', value: { gte: c.value + 1 } }];
    if (c.op === 'lte') return [{ type: 'age', value: { lte: c.value } }];
    if (c.op === 'lt') return [{ type: 'age', value: { lte: c.value - 1 } }];
    return null;
  }
  const values = c.op === 'eq' ? [c.value] : c.op === 'in' ? c.values : null;
  if (!values) return null;
  if (field === 'gender') {
    const g = values.map((v) => GENDER[String(v).toLowerCase()]);
    return g.every(Boolean) ? [{ type: 'gender', value: g }] : null;
  }
  return [{ type: 'region', value: values }];
}

export type SyncProject = { code: string; name: string; audience: string; countries: string[]; target: number; ir: number; loi: number; cpiCost: number };
export type SyncQuota = { key: string; label: string; condition: unknown; target: number };
export type SyncOptions = {
  /** Filters per quota key, for quotas that do not translate automatically (or to override). */
  quotaFilters?: Record<string, PanelFilter[]>;
  /** Filters applied to every person in a market, per country code (e.g. car owners only). */
  marketFilters?: Record<string, PanelFilter[]>;
  /** Completes per country; by default the target is split evenly. */
  completes?: Record<string, number>;
  links?: { test?: string; live?: string };
  softLaunch?: number;
};

export type SyncPreview = { body: PanelProjectBody; unmapped: { key: string; label: string }[]; notes: string[] };

/** Splits n across k markets as evenly as possible, the first markets taking the remainder. */
const split = (n: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));

export function buildPanelProject(p: SyncProject, quotas: SyncQuota[], o: SyncOptions = {}): SyncPreview {
  const countries = [...new Set(p.countries.map((c) => c.toUpperCase()))];
  if (!countries.length) throw new Error('The project has no countries');
  const notes: string[] = [];
  const unmapped: SyncPreview['unmapped'] = [];
  const quotaRows: PanelQuota[] = [];
  for (const q of quotas) {
    const filters = o.quotaFilters?.[q.key] ?? conditionToFilters(q.condition);
    if (!filters) { unmapped.push({ key: q.key, label: q.label }); continue; }
    quotaRows.push({ quotaID: q.key, label: q.label, filters, target: q.target });
  }
  if (unmapped.length) notes.push(`${unmapped.length} quota(s) need panel filters before they can be sent: ${unmapped.map((u) => u.label).join(', ')}`);
  const even = split(p.target, countries.length);
  if (!o.completes && countries.length > 1) notes.push(`The target of ${p.target} is split evenly across ${countries.length} markets; set completes per market to change it.`);
  // Quota targets are project-wide in Sampledge; on the panel each market gets its share.
  const markets: PanelMarket[] = countries.map((cc, i) => {
    const completes = o.completes?.[cc] ?? even[i];
    const share = p.target ? completes / p.target : 0;
    return {
      marketID: `${p.code}-${cc}`,
      country: [cc],
      targetGroup: p.audience,
      filters: o.marketFilters?.[cc] ?? [],
      quotas: quotaRows.map((q) => ({ ...q, quotaID: `${q.quotaID}-${cc}`, target: Math.round(q.target * share) })),
      completes,
      loi: p.loi,
      // Sampledge stores incidence as a fraction (0.35); the panel expects a percentage (35).
      ir: Math.round(p.ir * 1000) / 10,
      cpi: p.cpiCost,
      ...(o.softLaunch ? { softLaunch: { enabled: true, completes: Math.max(1, Math.round(o.softLaunch * share)) } } : {}),
      ...(o.links && { links: o.links }),
    };
  });
  return { body: { pid: p.code, name: p.name, markets }, unmapped, notes };
}

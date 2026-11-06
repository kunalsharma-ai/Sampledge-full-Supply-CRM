/** Survey outcomes returned by a survey host (§5.3). Same slugs as PROJEXA and ZAPX. */
export const OUTCOMES = ['complete', 'terminate', 'quota_full', 'quality_fail', 'duplicate', 'security_reject', 'partial', 'technical_error'] as const;
export type Outcome = (typeof OUTCOMES)[number];

const ALIASES: Record<string, Outcome> = {
  screenout: 'terminate',
  overquota: 'quota_full',
  abandoned: 'partial',
  error: 'technical_error',
};

export function parseOutcome(slug: string | undefined | null): Outcome | null {
  if (!slug) return null;
  const s = slug.trim().toLowerCase();
  if ((OUTCOMES as readonly string[]).includes(s)) return s as Outcome;
  return ALIASES[s] ?? null;
}

/** Outcomes after which SAMPLEON tries to route the respondent to another survey. */
export const ROUTABLE: Outcome[] = ['terminate', 'quota_full'];

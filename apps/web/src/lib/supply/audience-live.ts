'use client';
/**
 * Live audience counts for the segment builder and feasibility. When the API is connected, the rule
 * tree is counted by POST /supply/audience/count (debounced as the rules change); otherwise the
 * screens keep estimating from the labelled demo sample.
 */
import { useEffect, useState } from 'react';
import { useOS } from '../store';
import type { FeasibilityResult, Group, Scenario } from './audience';
import { countAudience, type AudienceCount } from './live';

export function useAudienceCount(root: Group, fatigueDays = 7): { data: AudienceCount | null; loading: boolean; error: string | null } {
  const mode = useOS((s) => s.mode);
  const session = useOS((s) => s.session);
  const [state, setState] = useState<{ data: AudienceCount | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const key = JSON.stringify(root) + fatigueDays;
  useEffect(() => {
    if (mode !== 'live' || !session) { setState({ data: null, loading: false, error: null }); return; }
    let off = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      countAudience(root, Math.min(60, Math.max(0, Math.round(fatigueDays))))
        .then((d) => { if (!off) setState({ data: d ?? null, loading: false, error: null }); })
        .catch((e: unknown) => { if (!off) setState({ data: null, loading: false, error: e instanceof Error ? e.message : 'Could not count' }); });
    }, 350);
    return () => { off = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, session]);
  return state;
}

/** Sorted [key, count] pairs from a tally. */
export const entries = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]);

/**
 * The feasibility walk (see feasibility() in ./audience) on recorded counts: eligible, reachable and
 * invitable come from the database, and the start rate from invitations and starts in the last 90 days.
 */
export function feasibilityFromCounts(c: AudienceCount, s: Scenario): FeasibilityResult {
  const lift = s.incentive === 'boosted' ? 1.18 : 1;
  const loiPenalty = s.loi <= 10 ? 1 : s.loi <= 20 ? 0.88 : 0.72;
  const startsRate = Math.min(0.85, (c.responseRate ?? 0.25) * lift * loiPenalty);
  const cr = 0.86;
  const starts = Math.round(c.invitable * startsRate);
  const expected = Math.round(starts * s.ir * cr);
  const spread = Math.min(0.35, 0.08 + 6 / Math.sqrt(Math.max(1, c.invitable)));
  const ratio = expected / Math.max(1, s.completes);
  return {
    eligible: c.eligible, reachable: c.reachable, invitable: c.invitable, starts, expected,
    low: Math.round(expected * (1 - spread)), high: Math.round(expected * (1 + spread)),
    perDay: expected / Math.max(5, s.days),
    daysNeeded: expected > 0 ? Math.ceil((s.completes / expected) * Math.max(5, s.days) * 0.55) : Infinity,
    feasible: ratio >= 1.25 ? 'yes' : ratio >= 0.9 ? 'tight' : 'no',
    byCountry: c.byCountry.map((x) => ({ code: x.code, eligible: x.eligible, expected: Math.round(x.invitable * startsRate * s.ir * cr) })),
    missingProfile: c.missingProfile,
  };
}

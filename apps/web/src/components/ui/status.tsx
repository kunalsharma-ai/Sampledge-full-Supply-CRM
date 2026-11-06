'use client';
/**
 * Status indicators. Every status pairs a colour with a distinct glyph and a text label, so it is
 * never conveyed by colour alone (WCAG 1.4.1). Status changes animate with a short pop.
 */
import { motion } from 'motion/react';
import { CheckCircle2, CircleDashed, CircleDot, CirclePause, Clock3, Flag, OctagonX, Radio, ShieldAlert, Sparkles, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tone } from './primitives';

export type Status =
  | 'live' | 'active' | 'soft-launch' | 'scheduled' | 'draft' | 'paused' | 'completed' | 'closed'
  | 'pending' | 'approved' | 'rejected' | 'failed' | 'flagged' | 'quota-full' | 'at-risk' | 'ai';

const map: Record<Status, { label: string; tone: Tone; icon: LucideIcon }> = {
  live: { label: 'Live', tone: 'cyan', icon: Radio },
  active: { label: 'Active', tone: 'emerald', icon: CircleDot },
  'soft-launch': { label: 'Soft launch', tone: 'purple', icon: CircleDot },
  scheduled: { label: 'Scheduled', tone: 'blue', icon: Clock3 },
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  paused: { label: 'Paused', tone: 'warn', icon: CirclePause },
  completed: { label: 'Completed', tone: 'emerald', icon: CheckCircle2 },
  closed: { label: 'Closed', tone: 'neutral', icon: CheckCircle2 },
  pending: { label: 'Pending', tone: 'warn', icon: Clock3 },
  approved: { label: 'Approved', tone: 'emerald', icon: CheckCircle2 },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle },
  failed: { label: 'Failed', tone: 'danger', icon: OctagonX },
  flagged: { label: 'Flagged', tone: 'danger', icon: Flag },
  'quota-full': { label: 'Quota full', tone: 'orange', icon: OctagonX },
  'at-risk': { label: 'At risk', tone: 'orange', icon: ShieldAlert },
  ai: { label: 'AI suggested', tone: 'purple', icon: Sparkles },
};

const toneCls: Record<Tone, string> = {
  blue: 'bg-blue/10 text-blue ring-blue/25', cyan: 'bg-cyan/10 text-cyan ring-cyan/25', purple: 'bg-purple/10 text-purple ring-purple/25',
  emerald: 'bg-emerald/10 text-emerald ring-emerald/25', orange: 'bg-orange/10 text-orange ring-orange/25', magenta: 'bg-magenta/10 text-magenta ring-magenta/25',
  danger: 'bg-danger/10 text-danger ring-danger/25', warn: 'bg-warn/10 text-warn ring-warn/25', neutral: 'bg-ink-3/10 text-ink-2 ring-ink-3/20',
};

export function StatusPill({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const s = map[status];
  const Icon = s.icon;
  return (
    <motion.span key={status} initial={{ scale: 0.92, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.18 }}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset', toneCls[s.tone], className)}>
      <Icon size={11} aria-hidden /> {label ?? s.label}
    </motion.span>
  );
}

/** Compact dot + label for dense tables. */
export function StatusDot({ status, label }: { status: Status; label?: string }) {
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className={cn('h-2 w-2 rounded-full ring-2', toneCls[s.tone].split(' ').filter((c) => c.startsWith('text-')).map((c) => c.replace('text-', 'bg-')).join(' '), 'ring-transparent')} aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export const statusMeta = (s: Status) => map[s];

/** Health of a quota or target: emerald ≥ on pace, warn slightly behind, danger far behind. */
export function paceStatus(achieved: number, target: number, elapsed: number): Status {
  if (target <= 0) return 'draft';
  if (achieved >= target) return 'quota-full';
  const pace = achieved / target / Math.max(0.05, elapsed);
  return pace >= 0.95 ? 'active' : pace >= 0.75 ? 'pending' : 'at-risk';
}

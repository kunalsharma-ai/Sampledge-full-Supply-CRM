/** Event envelope v1 and the event catalogue (docs/ECOSYSTEM_ARCHITECTURE.md §6). */
import { z } from 'zod';
import { newEventId, SOURCE_PLATFORMS, SYSTEMS, type SystemName } from './ids';
import { OUTCOMES } from './outcomes';

const counts = z.object({ required: z.number().int(), completes: z.number().int(), remaining: z.number().int() });
const countryCounts = z.record(z.string(), z.object({ target: z.number().int(), completes: z.number().int() }));
const quotaFill = z.array(z.object({ id: z.string(), country: z.string().nullable(), target: z.number().int(), completes: z.number().int(), full: z.boolean() }));
const sessionRef = { sessionId: z.string(), country: z.string(), quotaIds: z.array(z.string()).default([]) };
/** Respondent-level fields: only sent to SUPPLY360, which owns the respondent. */
const respondent = { respondentRef: z.string().optional(), panel: z.string().optional() };

export const EVENT_PAYLOADS = {
  'project.created': z.object({ projectId: z.string(), name: z.string(), countries: z.array(z.string()).default([]) }),
  'audience_request.submitted': z.object({ title: z.string().nullable(), countries: z.array(z.string()), requiredCompletes: z.number().int(), status: z.string() }),
  'feasibility.calculated': z.object({
    feasible: z.boolean(),
    eligible: z.number().int(),
    reachable: z.number().int(),
    estimatedCompletes: z.number().int(),
    shortfall: z.number().int(),
    byCountry: z.record(z.string(), z.object({ eligible: z.number().int(), reachable: z.number().int(), estimatedCompletes: z.number().int() })),
  }),
  'audience.approved': z.object({ approvedBy: z.string(), allocation: z.record(z.string(), z.number().int()) }),
  'batch.scheduled': z.object({ batchId: z.string(), size: z.number().int(), scheduledAt: z.string(), mode: z.enum(['soft', 'full']) }),
  'invitation.delivered': z.object({ batchId: z.string(), delivered: z.number().int(), suppressed: z.number().int(), ...respondent, invitationId: z.string().optional() }),
  'survey.started': z.object({ ...sessionRef, ...respondent, routedFrom: z.string().nullable().default(null) }),
  'survey.completed': z.object({ ...sessionRef, ...respondent, loiMinutes: z.number().nullable(), rewardPoints: z.number().int(), verified: z.literal(true), progress: counts }),
  'survey.screenout': z.object({ ...sessionRef, ...respondent, outcome: z.enum(OUTCOMES), routedTo: z.string().nullable() }),
  'quota.full': z.object({ quotaId: z.string(), country: z.string().nullable(), target: z.number().int() }),
  'quality.failed': z.object({ ...sessionRef, ...respondent, reason: z.string() }),
  'reward.eligibility_confirmed': z.object({ sessionId: z.string(), respondentRef: z.string(), points: z.number().int(), ledgerEntryId: z.string() }),
  'project.quota_updated': z.object({ progress: counts, byCountry: countryCounts, quotas: quotaFill, sequence: z.number().int() }),
  'project.closed': z.object({ reason: z.string().optional(), progress: counts.optional() }),
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[];
export type EventPayload<T extends EventType> = z.output<(typeof EVENT_PAYLOADS)[T]>;

export const EventEnvelope = z.object({
  specVersion: z.literal('1.0'),
  eventId: z.string().uuid(),
  type: z.string().min(1).max(80),
  version: z.number().int().min(1),
  source: z.enum(SYSTEMS),
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1).max(120),
  causationId: z.string().max(120).nullable().optional(),
  subject: z.object({
    sourcePlatform: z.enum(SOURCE_PLATFORMS).optional(),
    sourceProjectId: z.string().max(120).optional(),
    surveyId: z.string().max(120).optional(),
    organizationId: z.string().max(120).optional(),
  }).default({}),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.output<typeof EventEnvelope>;

export function makeEvent<T extends EventType>(args: {
  type: T;
  source: SystemName;
  correlationId: string;
  causationId?: string | null;
  subject?: EventEnvelope['subject'];
  payload: z.input<(typeof EVENT_PAYLOADS)[T]>;
  nowMs?: number;
}): EventEnvelope {
  const payload = EVENT_PAYLOADS[args.type].parse(args.payload) as Record<string, unknown>;
  return {
    specVersion: '1.0',
    eventId: newEventId(),
    type: args.type,
    version: 1,
    source: args.source,
    occurredAt: new Date(args.nowMs ?? Date.now()).toISOString(),
    correlationId: args.correlationId,
    causationId: args.causationId ?? null,
    subject: args.subject ?? {},
    payload,
  };
}

export type ParsedEvent =
  | { ok: true; known: true; event: EventEnvelope; type: EventType }
  | { ok: true; known: false; event: EventEnvelope }
  | { ok: false; error: string };

/** Validate an inbound event. Unknown type/version pairs are valid but `known: false` (acknowledge and ignore). */
export function parseEvent(raw: unknown): ParsedEvent {
  const env = EventEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, error: env.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const e = env.data;
  if (!(e.type in EVENT_PAYLOADS) || e.version !== 1) return { ok: true, known: false, event: e };
  const p = EVENT_PAYLOADS[e.type as EventType].safeParse(e.payload);
  if (!p.success) return { ok: false, error: `payload: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  return { ok: true, known: true, type: e.type as EventType, event: { ...e, payload: p.data as Record<string, unknown> } };
}

/** Strip respondent-level fields before an event leaves for a system that does not own respondents. */
export function withoutRespondent(e: EventEnvelope): EventEnvelope {
  const { respondentRef: _r, panel: _p, invitationId: _i, ...rest } = e.payload as Record<string, unknown>;
  return { ...e, payload: rest };
}

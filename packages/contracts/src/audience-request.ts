/** Audience Request v1 (docs/ECOSYSTEM_ARCHITECTURE.md §3). */
import { z } from 'zod';
import { Criteria } from './criteria';
import { SOURCE_PLATFORMS } from './ids';

export const Country = z.string().regex(/^[A-Z]{2}$/, 'Use ISO 3166-1 alpha-2, e.g. US');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use an ISO date');
const ExternalId = z.string().min(1).max(120).regex(/^[\w.:\-]+$/);

export const QuotaDef = z.object({
  id: z.string().min(1).max(60).regex(/^[\w.\-]+$/),
  label: z.string().max(120).optional(),
  country: Country.optional(),
  conditions: Criteria.default([]),
  target: z.number().int().min(1).max(1_000_000),
  hard: z.boolean().default(true),
});
export type QuotaDef = z.infer<typeof QuotaDef>;

export const AudienceRequestInput = z
  .object({
    source: z.object({
      platform: z.enum(SOURCE_PLATFORMS),
      projectId: ExternalId,
      surveyId: ExternalId,
    }),
    organization: z.object({ id: ExternalId, name: z.string().min(1).max(200) }),
    title: z.string().min(1).max(200).optional(),
    countries: z.array(Country).min(1).max(60),
    targeting: z.object({
      criteria: Criteria.default([]),
      naturalLanguage: z.string().max(2000).optional(),
    }),
    requiredCompletes: z.number().int().min(1).max(1_000_000),
    completesByCountry: z.record(Country, z.number().int().min(0).max(1_000_000)).optional(),
    quotas: z.array(QuotaDef).max(200).default([]),
    expectedIncidence: z.number().gt(0).max(1),
    loiMinutes: z.number().int().min(1).max(180),
    reward: z.object({ points: z.number().int().min(0).max(1_000_000), currency: z.string().length(3).optional(), value: z.number().min(0).optional() }),
    fieldwork: z.object({ start: IsoDate, end: IsoDate }),
    survey: z.object({
      launchUrl: z.string().url().max(2000),
      testUrl: z.string().url().max(2000).optional(),
      language: z.string().min(2).max(20),
    }),
    redirects: z.object({ allowRouting: z.boolean().default(true), endUrl: z.string().url().max(2000).optional() }).default({ allowRouting: true }),
    exclusions: z.object({ surveyIds: z.array(ExternalId).max(200).default([]), audienceRequestIds: z.array(z.string()).max(200).default([]) }).default({ surveyIds: [], audienceRequestIds: [] }),
    callbackUrl: z.string().url().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fieldwork.end < v.fieldwork.start) ctx.addIssue({ code: 'custom', path: ['fieldwork', 'end'], message: 'Fieldwork ends before it starts' });
    if (v.completesByCountry) {
      for (const c of Object.keys(v.completesByCountry)) if (!v.countries.includes(c)) ctx.addIssue({ code: 'custom', path: ['completesByCountry', c], message: `${c} is not one of the countries` });
    }
    for (const q of v.quotas) if (q.country && !v.countries.includes(q.country)) ctx.addIssue({ code: 'custom', path: ['quotas'], message: `Quota ${q.id} is for ${q.country}, which is not one of the countries` });
  });
export type AudienceRequestInput = z.input<typeof AudienceRequestInput>;
export type AudienceRequestSpec = z.output<typeof AudienceRequestInput>;

/** Approved project changes from the source system (§5.2 PATCH). */
export const AudienceRequestChange = z.object({
  requiredCompletes: z.number().int().min(1).max(1_000_000).optional(),
  completesByCountry: z.record(Country, z.number().int().min(0).max(1_000_000)).optional(),
  quotas: z.array(QuotaDef).max(200).optional(),
  fieldwork: z.object({ start: IsoDate, end: IsoDate }).optional(),
  survey: z.object({ launchUrl: z.string().url().max(2000).optional() }).optional(),
});

export const REQUEST_STATUSES = ['draft', 'submitted', 'feasibility_ready', 'approved', 'soft_launch', 'live', 'paused', 'closed', 'rejected', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const ACTIVE_STATUSES: RequestStatus[] = ['soft_launch', 'live'];

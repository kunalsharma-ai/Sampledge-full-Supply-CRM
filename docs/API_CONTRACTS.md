# API contracts (Phase 3 target)

REST under `/api/v1`, JSON, cursor pagination (`?cursor=&limit=`), `Idempotency-Key` on POSTs that create money-bearing records. Every request is tenant-scoped by the auth token. WebSocket channel `/ws` for live counters. Types reference `src/lib/demo/data.ts` and `src/lib/survey/engine.ts`, which Phase 2 already uses.

Fields marked 🔒 are stripped for roles lacking the named permission.

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | email + password or SSO redirect; returns session; MFA challenge if enabled |
| POST | `/auth/mfa/verify` | TOTP |
| GET | `/me` | user, memberships, role, permissions |

## CRM & bidding
| Method | Path | Body / result |
|---|---|---|
| GET | `/opportunities?stage=` | `Opportunity[]` (🔒 `margin` needs `view:margins`) |
| POST | `/opportunities` | `{ title, clientId, audience, countries[], sampleSize, incidence, loiMinutes, valueCents }` → `Opportunity` (stage `NewRFQ`) |
| POST | `/rfq/parse` | `{ text }` → `{ n?, ir?, loi?, country?, audience?, ambiguities[] }` |
| PATCH | `/opportunities/:id/stage` | `{ stage }`. `Won` emits `opportunity.won` → Projects creates a project |
| POST | `/opportunities/:id/feasibility` | `{ vendorIds[] }` → `FeasibilityRequest[]` |
| GET | `/pricing/estimate` | `?audience&country&n&ir&loi` → `{ vendors: [{ vendorId, cpiEstimate, capacityEstimate, score, parts }] , basis: "rate_card_estimate" }` |
| POST | `/opportunities/:id/quotes` | `{ cpiSellCents }` → `Quote` (status `draft`) |
| POST | `/quotes/:id/submit` | creates `ApprovalRequest(kind=quote)`; sending is blocked until approved |

## Projects
| Method | Path | Notes |
|---|---|---|
| GET | `/projects?stage=&type=&q=` | list (client role: own client only) |
| GET | `/projects/:id` | includes quotas, allocations, blockers, 🔒 `cpiCost`, 🔒 `margin` |
| PATCH | `/projects/:id/stage` | `{ stage }`; audited; emits `project.stage_changed` |
| GET | `/projects/:id/risk` | `{ deadline, quotas, cost }` computed signals with record references |
| GET | `/projects/:id/timeline` | comms + audit events |

## Surveys
| Method | Path | Notes |
|---|---|---|
| POST | `/surveys` | `{ name, projectId? }` |
| POST | `/surveys/:id/versions` | `{ definition: SurveyDef }` → new immutable version |
| POST | `/surveys/:id/versions/:v/qa` | `{ simulations }` → `{ issues: QaIssue[], sim }` |
| POST | `/surveys/:id/versions/:v/publish` | creates `ApprovalRequest(kind=publish)` |
| POST | `/surveys/import` | multipart (docx/pdf/xlsx/csv/txt) → draft `SurveyDef` + ambiguity list; never publishes |
| POST | `/surveys/:id/assist` | `{ instruction }` → `{ summary, diff, proposedDefinition }` (applied only via new version) |

### Respondent runtime
| Method | Path | Notes |
|---|---|---|
| POST | `/r/:surveyId/start` | `{ source, respondentRef }` → `{ sessionId, question }` |
| POST | `/r/session/:sid/answer` | `{ questionId, value }` → `{ next?: Question, outcome? }`, server runs `engine.answer` and quota check atomically |
| GET | `/r/session/:sid/redirect` | partner redirect by outcome (complete/screenout/overquota) |

## Sample Exchange
| Method | Path | Notes |
|---|---|---|
| GET | `/vendors` | vendor role: only self |
| GET | `/vendors/:id/performance` | quality, reliability, response rate, history |
| POST | `/projects/:id/allocations` | `{ vendorId, completes, cpiCents }` → `proposed`; PO needs `approve:purchase` |
| GET | `/opportunities/open-to-vendor` | vendor view: anonymised client, no competing bids |

## Panels
| Method | Path | Notes |
|---|---|---|
| GET | `/panels/:brand/metrics?from&to` | aggregate only |
| GET | `/panels/:brand/panelists?q=` | 🔒 identity needs `view:panelist_pii` |
| PUT | `/panels/:brand/reward-policies` | configurable categories and thresholds |
| POST | `/panels/:brand/import` | secure file import with mapping + consent validation |
| POST | `/panelists/:id/dsar` | data access / deletion request |

## Analytics
| Method | Path | Notes |
|---|---|---|
| POST | `/datasets/:id/crosstab` | `{ rows, cols, metric, weighted }` → cells with base, pct, sig letters |
| POST | `/datasets/:id/segments` | `{ vars[], k }` |
| POST | `/reports` | `{ datasetId, template }` → PPTX/XLSX/PDF job; narrative flagged `ai_generated: true` |

## Automation
| Method | Path | Notes |
|---|---|---|
| GET | `/agents` · PATCH `/agents/:id` | enable, cost cap |
| PUT | `/workflows/:id` | `{ graph }` → new version after validation |
| POST | `/workflows/:id/test` | dry-run, no side effects |
| GET | `/approvals?status=pending` · POST `/approvals/:id/decision` | `{ decision }`, permission per kind |

## WebSocket events
`quota.updated`, `project.stage_changed`, `response.recorded`, `approval.requested`, `notification.created`. Payloads carry ids + changed fields only.

## Errors
`{ error: { code, message, details? } }` with codes `unauthenticated`, `forbidden`, `not_found`, `validation_failed`, `approval_required`, `quota_full`, `rate_limited`.

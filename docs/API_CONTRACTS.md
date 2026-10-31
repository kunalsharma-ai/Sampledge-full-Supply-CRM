# API reference (Phase 3, implemented)

REST under `/api/v1`, JSON. The browser calls same-origin `/api/v1/*` (Next proxies to the API) with an httpOnly session cookie; API clients can send `Authorization: Bearer <token>` (ask for it with `returnToken: true` at sign-in). Bodies are validated with zod; failures return `400 { message, issues: [{ path, message }] }`.

Access rules on every route: the session's **tenant** scopes all queries (another tenant's id returns 404); the role's **module access** from `packages/core/src/roles.ts` gates reads (`none` → 403) and writes (`read` → 403); listed **permissions** are required. Fields marked 🔒 are removed from responses for roles without the named permission. Scoped roles: *vendor* sees its own vendor and allocations only; *client* sees its own client's projects and surveys only.

Source of truth: `apps/api/src/modules/*.ts`. Tests: `apps/api/src/test/api.test.ts`.

## Health and auth
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | public; checks the database |
| POST | `/auth/login` | `{ email, password, tenant?, returnToken? }` → sets cookie; `{ mfaRequired: true, challenge }` when MFA is on. Rate-limited per IP |
| POST | `/auth/mfa/verify` | `{ challenge, code }` → sets cookie |
| POST | `/auth/logout` | revokes the session |
| GET | `/auth/me` | user, tenant, role, vendorId/clientId, permissions, module access |
| POST | `/auth/mfa/enroll` · `/auth/mfa/activate` | TOTP secret + otpauth URL; activate with a valid code |

## Projects and clients (module `projects`)
| Method | Path | Notes |
|---|---|---|
| GET | `/projects?stage&clientId&q` | with quota cells, allocations, surveys. 🔒 `cpiCost`, `budget`, `costIncurred` (`view:margins`); allocation 🔒 `cpi` (`view:vendor_bids`) |
| GET | `/projects/:id` | same redaction |
| POST | `/projects` | `edit:projects`; code assigned `SE-26nnn` |
| PATCH | `/projects/:id/stage` | `{ stage }` one of the 16 lifecycle stages; audited |
| PATCH | `/projects/:id` | `{ owner?, deadline?, blockers?, target? }` |
| POST | `/projects/:id/allocations` | `{ vendorId, completes, cpi }` → allocation `proposed` + approval *Purchasing sample*. Vendor must cover the project's audience and a market |
| GET | `/clients` | client role: own client only |

## CRM and quotes (module `crm`)
| Method | Path | Notes |
|---|---|---|
| GET | `/opportunities` · `/opportunities/:id` | with quotes. 🔒 `margin`, quote `cpiCost` |
| POST | `/opportunities` | `{ title, clientId, audience, countries[], sampleSize, incidence, loi, owner, sourceText? }` → stage *New RFQ* |
| PATCH | `/opportunities/:id/stage` | `{ stage, lossReason? }`. *Won* creates the project in the same transaction (priced from the latest approved quote); *Lost* needs a reason; a Won deal cannot move back |
| POST | `/opportunities/:id/quotes` | `view:margins`; `{ targetMargin }` → draft quote from vendor rate cards, `basis: rate_card_estimate`, per-country coverage |
| POST | `/quotes/:id/submit` | → `pending_approval` + approval *Sending binding quotations* |
| GET | `/vendor-ranking?audience&country&n&ir&loi` | explainable ranking (score parts per factor); rate-card estimates |

## Vendors (module `marketplace`)
| Method | Path | Notes |
|---|---|---|
| GET | `/vendors` · `/vendors/:id` | vendor role: own record only. 🔒 `cpiB2C/B2B/HC`, `pendingPayment`, `bidWinRate` (`view:vendor_bids`, or own record) |
| GET | `/allocations` | vendor role: own allocations only |

## Surveys (module `survey-studio`)
| Method | Path | Notes |
|---|---|---|
| GET | `/surveys` · `/surveys/:id` | `:id` includes the current definition with live quota counts |
| GET | `/surveys/:id/versions` · `/surveys/:id/versions/:v` | immutable version history |
| POST | `/surveys` | `edit:surveys`; `{ name, projectId, languages[] }` |
| PUT | `/surveys/:id/definition` | `edit:surveys`; `{ definition, label, baseVersion }` → new version. Structural validation (question ids, condition AST, rules, quotas); stale `baseVersion` → 400. Quota cells upsert by key, keeping counts |
| POST | `/surveys/:id/qa` | `{ simulations }` → issues + simulated journeys; `publishable` false while critical issues exist |
| POST | `/surveys/:id/publish` | `edit:surveys`; refused with critical QA issues; otherwise approval *Publishing surveys* (idempotent while pending) |
| GET | `/surveys/:id/responses?outcome&take` | rows + counts by outcome and source + quota cells |

## Respondent runtime (public)
| Method | Path | Notes |
|---|---|---|
| POST | `/r/:surveyId/start` | `{ source?, respondent?, preview? }`. Live only for *Published* surveys; preview needs a signed-in user with Survey Studio access and never counts |
| GET | `/r/session/:responseId` | current question (piped text, seeded option order), progress |
| POST | `/r/session/:responseId/answer` | `{ questionId, value }` → next question or `outcome`. 422 on invalid or out-of-order answers. On completion, matching quota cells increment atomically (`count < target` for hard cells); losing a race returns `overquota` and rolls back |

## Panels (module `panels`)
| Method | Path | Notes |
|---|---|---|
| GET | `/panels/summary` | per brand, from panelist rows (synthetic) |
| GET | `/panels/panelists?brand&status&country&segment&skip&take` | paginated; pseudonymous |
| GET | `/panels/panelists/:id` | with consent history |
| POST | `/panels/panelists/:id/consents` | `{ purpose, granted }`; health-data consent only for MyHealthOpinions |
| POST | `/panels/panelists/:id/deletion-request` | status → `deletion_requested` + approval *Deleting records* |

## Approvals, automation, notifications, audit
| Method | Path | Notes |
|---|---|---|
| GET | `/approvals?status` | requests the caller made or may decide (`canDecide` per row). Client: publish requests on own projects; vendor: none |
| POST | `/approvals/:id/decision` | `{ decision: approved|rejected, note? }`. Needs the kind's permission (quotes → `approve:quotes`, purchases → `approve:purchase`, payments → `approve:payments`, publishing → `approve:publish`, respondent rejection → `edit:projects`, high-volume comms → `edit:automations`; datasets and deletions → platform admin or executive). Requester cannot decide. Effect applied in the same transaction |
| GET | `/agents` · PATCH `/agents/:id` | module `automation`; toggling needs `edit:automations` |
| GET | `/notifications` · POST `/notifications/read-all` | filtered to the caller's role |
| GET | `/audit?entity&entityId&take` | module `admin` |
| GET | `/dashboard/summary` | module `command-center`; KPIs computed from the database. 🔒 `grossMargin` |

## Planned (Phase 4+)
Cursor pagination on all lists, `Idempotency-Key` on money-bearing POSTs, WebSocket `/ws` for live counters, supplier feasibility requests, invoices and payables, Comms Hub sends, panel CSV import, response exports.

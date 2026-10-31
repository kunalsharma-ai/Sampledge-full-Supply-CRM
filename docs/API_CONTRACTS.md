# API reference (Phases 3–4, implemented)

REST under `/api/v1`, JSON. The browser calls same-origin `/api/v1/*` (Next proxies to the API) with an httpOnly session cookie; API clients can send `Authorization: Bearer <token>` (ask for it with `returnToken: true` at sign-in). Bodies are validated with zod; failures return `400 { message, issues: [{ path, message }] }`.

Access rules on every route: the session's **tenant** scopes all queries (another tenant's id returns 404); the role's **module access** from `packages/core/src/roles.ts` gates reads (`none` → 403) and writes (`read` → 403); listed **permissions** are required. Fields marked 🔒 are removed from responses for roles without the named permission. Scoped roles: *vendor* sees its own vendor and allocations only; *client* sees its own client's projects and surveys only.

Source of truth: `apps/api/src/modules/*.ts`. Tests: `apps/api/src/test/api.test.ts`, `apps/api/src/test/workflow.test.ts`.

## Health and auth
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | public; checks the database; `outboxPending` |
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
| GET | `/surveys/:id/responses.csv` | one row per response: response_id, version, source, outcome, started_at, completed_at, then one column per question |

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
| POST | `/panels/import` | `{ brand, csv, dryRun = true }` → `{ accepted, skipped, errors[], errorCount }`. Header: `handle,country,age_band,gender,segment[,status][,consent_research]`. Rows with an email address or phone number are rejected; existing handles skipped; ≤ 5,000 rows |

## Approvals, automation, notifications, audit
| Method | Path | Notes |
|---|---|---|
| GET | `/approvals?status` | requests the caller made or may decide (`canDecide` per row). Client: publish requests on own projects; vendor: none |
| POST | `/approvals/:id/decision` | `{ decision: approved|rejected, note? }`. Needs the kind's permission (quotes → `approve:quotes`, purchases → `approve:purchase`, payments → `approve:payments`, publishing → `approve:publish`, respondent rejection → `edit:projects`, high-volume comms → `edit:automations`; datasets, deletions and granting admin access → platform admin or executive). Requester cannot decide. Effect applied in the same transaction |
| GET | `/agents` · PATCH `/agents/:id` | module `automation`; toggling needs `edit:automations` |
| GET | `/notifications` · POST `/notifications/read-all` · POST `/notifications/:id/read` | filtered to the caller's role; `read`/`readAt` are per person |
| GET | `/audit?entity&entityId&action&actor&take` | module `admin`; `action` matches a prefix, `actor` a case-insensitive substring |
| GET | `/dashboard/summary` | module `command-center`; KPIs computed from the database. 🔒 `grossMargin` |

## Supplier feasibility (modules `crm`, `vendor-portal`)
| Method | Path | Notes |
|---|---|---|
| POST | `/opportunities/:id/feasibility` | crm write; `{ vendorIds?, dueInDays = 3 }`. Default: top 3 ranked vendors per market. Idempotent per vendor and market; moves *New RFQ* / *Qualifying* to *Feasibility*; emails each vendor |
| GET | `/opportunities/:id/feasibility` | answers per vendor and market. 🔒 `cpi` (`view:vendor_bids`) |
| GET | `/feasibility` | vendor portal inbox. Vendor: own requests only. No client identity; reference `RFQ-xxxxxx` |
| POST | `/feasibility/:id/respond` | **vendor role only**, own request: `{ cpi, capacity, note? }` or `{ decline: true }`; answered once |

## Finance (module `finance`)
| Method | Path | Notes |
|---|---|---|
| GET | `/finance/summary` | receivable, overdue, collected, payable, paid out, PO count (scoped per role) |
| GET | `/invoices` | client: own client, issued and paid only |
| POST | `/invoices` | `{ projectId }` → draft from delivered completes × sell CPI; one per project |
| POST | `/invoices/:id/issue` | `{ termsDays = 30 }` → issued + client email |
| POST | `/invoices/:id/mark-paid` | issued → paid (recorded) |
| GET | `/purchase-orders` · `/payables` | `view:vendor_bids` roles; vendor: own only; others get `[]` |
| POST | `/payables/:id/request-payment` | open → `pending_approval` + approval *Issuing payments*; approval marks it paid and reduces the vendor's pending balance |

## Comms Hub (module `communications`)
| Method | Path | Notes |
|---|---|---|
| GET | `/comms/messages?take` | vendor/client: messages to them and their own messages to the team |
| GET | `/comms/templates` · POST `/comms/render` | `{ key, vars }` → subject and body |
| GET | `/comms/preview?audience&target` | recipients after consent filtering, `needsApproval`, threshold, adapter |
| POST | `/comms/messages` | `{ channel: email|sms|in_app, audience, target, subject, body }`. Targets: `client:<id>`, `vendor:<id>`, `panel:<brand>:<all|active|dormant>`, `role:<role>`. Above `COMMS_HIGH_VOLUME` (100) → approval *High-volume communications*; otherwise queued. Vendors and clients may only target `internal` |

## Survey results and quality (module `analytics`, rejection `survey-studio`)
| Method | Path | Notes |
|---|---|---|
| GET | `/surveys` | now includes `completes` (recorded, non-preview, not rejected) |
| GET | `/surveys/:id/results?banner=Q&excludeFlagged=true` | `{ survey, base, flagged, rejected, excludedFlagged, banner: {id,text,cols[{code,label,letter,base}]}, questions[] }`. Question shapes: single/multi `rows[{code,label,count,pct,byBanner?[{count,base,pct,sig[]}]}]`, numeric `mean/median/min/max`, nps `nps/promoters/passives/detractors`, matrix `rows[{dist[]}]`, text `samples[]` |
| GET | `/surveys/:id/report.pptx?banner&excludeFlagged` | PowerPoint file; 400 when there are no completes; audited |
| POST | `/surveys/:id/responses/:rid/reject` `{reason}` | creates a *Rejecting respondents* approval (`{approval}`), or `{alreadyPending:true}`. Approval excludes the interview and decrements its quota cells and the project's completes |

`responses.csv` gains `quality_flags` and `rejected` columns.

## AI gateway
Each task response is `{ data, provider: 'rules'|'anthropic', model, status: 'ok'|'fallback'|'refused'|'error'|'cap_reached', note, costUsd }`.
| Method | Path | Module | Notes |
|---|---|---|---|
| GET | `/ai/status` | any signed-in | provider, model, connected, monthSpendUsd, monthCalls, capUsd, tasks[] |
| GET | `/ai/usage?take=50` | `admin` | recent `AiCall` rows |
| GET | `/panel-backend` | `panels` | `{owner, verifiedAgainstBackend, panels[{panel, name, host, connected, note}]}`; no network call |
| GET | `/panel-backend/calls?take=50` | `panels` | `PanelCall` rows (approved actions and their outcome) |
| POST | `/panel-backend/:panel/check` | `panels`, owning workspace | reads the app user's profile on the panel to confirm the token |
| POST | `/panel-backend/:panel/cpi` `{category, subcategory?, ir, loi, country}` | `panels`, owning workspace | the backend's `{status, data, message}`; `data` unchanged |
| GET | `/panel-backend/:panel/cpi/categories`, `/panel-backend/:panel/options/:country/:field` | `panels`, owning workspace | backend data unchanged |
| POST | `/panel-backend/:panel/feasibility` `{filter}` | `panels`, owning workspace | filter passed through unchanged |
| GET | `/panel-backend/:panel/projects/:id`, `.../qualified` | `panels`, owning workspace | backend data unchanged |
| GET | `/panel-backend/projects`, `/panel-backend/syncs` | `panels`, owning workspace | projects that can be synced; synced projects with imported counts by outcome |
| POST | `/panel-backend/:panel/reach` `{country, filters?, activeWithinDays?}` | `panels`, owning workspace | the panel's reach counts, unchanged |
| GET | `/panel-backend/:panel/questions?category=`, `/panel-backend/:panel/respondents/:rid` | `panels`, owning workspace | the panel's profile questions; one pseudonymous profile |
| POST | `/panel-backend/:panel/sync/:projectId/preview` `{quotaFilters?, marketFilters?, completes?, links?, softLaunch?}` | `panels`, owning workspace | `{body, unmapped[], notes[]}`; no network call |
| POST | `/panel-backend/:panel/sync/:projectId` (same body) | `panels` (write), owning workspace | 400 while any quota lacks panel filters; else sends the project (no invitations) and logs a `sync` PanelCall |
| GET | `/panel-backend/:panel/sync/:projectId` | `panels`, owning workspace | imported counts by outcome, plus the panel's live status or the error reaching it |
| POST | `/panel-backend/:panel/sync/:projectId/import` | `panels` (write), owning workspace | `{received, pages, more}`; 502 with the reason if the feed fails (position kept) |
| POST | `/panel-backend/:panel/projects/:id/actions` `{action: invites\|soft-launch\|cancel, body?}` | `panels` (write), owning workspace | 202 with the approval; nothing is sent until someone else approves. Backend errors return 502 (never 401/403); not connected returns 503 |
| GET | `/ai/evals` | `admin` | evaluation set scored on the rule-based implementations: `{provider, model, at, tasks[{task, version, cases, passed, checks, checksPassed, criticalFailed, costUsd, results[]}], totals}` |
| POST | `/ai/evals/run` | `admin` (write) | same report from the connected model; 400 without a model or once the monthly cap is spent; the run's cost is logged as one `AiCall` (`task: evals.run`) |
| POST | `/ai/rfq-extract` `{text}` | `crm` | `{audience, countries[], sampleSize, incidence, loi, title, missing[]}` |
| POST | `/ai/questionnaire` `{text}` or `{fileName, base64}` | `survey-studio` | `.docx .xlsx .pdf .txt .csv .md`, ≤ 8 MB. Returns `{source, chars, text, result}`; `result.data.questions[]`. Nothing is saved |
| GET | `/ai/projects/:id/summary` | `projects` | `{headline, bullets[], risks[{level,text}], nextSteps[]}`; budget facts only for `view:margins` |

## DIY research (module `diy`)
| Method | Path | Notes |
|---|---|---|
| GET | `/diy/estimate?audience&countries=US,GB&sampleSize&incidence&loi` | `{markets[{country,n,covered,cpiLow,cpiHigh,capacityOk}], totalLow, totalHigh, basis:'rate_card_estimate', disclaimer}`. No vendor names or costs |
| POST | `/diy/requests` `{...spec, title, objective}` | client users only; creates an opportunity (`channel:'diy'`, stage *New RFQ*) and emits `diy.requested` |
| GET | `/diy/requests` | client: own requests with client-facing status; internal roles: all DIY requests |

## Data Processing (module `data-processing`)
| Method | Path | Notes |
|---|---|---|
| GET | `/dp/surveys` | programmed surveys with completes, weighted, codeframe count |
| GET | `/dp/surveys/:id` | completes, outcomes, flags, rejected, synthetic, median minutes, weighting, weighting variables (with sample shares), open ends (answered, coded, manual, codeframe) |
| PUT | `/dp/surveys/:id/weighting` `{targets:{Q:{code:share}}}` | rakes and stores weights; returns iterations, converged, efficiency, effectiveBase, min/max weight, achieved. 400 if targets do not sum to 100% or a targeted group is empty |
| DELETE | `/dp/surveys/:id/weighting` | weights back to 1 |
| POST | `/dp/surveys/:id/codeframes/:qid/suggest` `{maxCodes}` | AI gateway result `{data:{codes[]}, provider, note, answers}` |
| PUT | `/dp/surveys/:id/codeframes/:qid` `{codes:[{code,label,keywords[]}]}` | saves and codes every answer; manual codes kept. Returns `{coded, tally}` |
| GET | `/dp/surveys/:id/codeframes/:qid/verbatims?code=&take=` | `[{id,text,codes,manual}]`; `code=other` or `uncoded` filters |
| PATCH | `/dp/responses/:rid/codes` `{questionId, codes[]}` | manual coding |
| GET | `/dp/surveys/:id/tables.xlsx?banner&weighted` | Excel workbook (Notes, Tables) |
| PUT | `/dp/surveys/:id/recodes/:rid` | `{label, source, kind: group\|bands, groups[{code,label,from?[],min?,max?}]}`; ids start with `R`; 400 with a readable reason when invalid |
| DELETE | `/dp/surveys/:id/recodes/:rid` | refused while the weighting uses it |
| GET | `/dp/surveys/:id/data.sav` | SPSS system file (see Data Processing in IMPLEMENTATION_STATUS) |
| GET | `/surveys/:id/report.pdf?banner&excludeFlagged&weighted` | PDF report (same content as `report.pptx`) |

`GET /surveys/:id/explore?from&to&trendQ&trendCode&interval=day|week&k=2..6&excludeFlagged&weighted` returns `{ base, weighted, synthetic, options{flow,segmentation,trend}, flow, trend, segments }`; each of `flow`, `trend`, `segments` is `{ ok: true, data }` or `{ ok: false, error }` so one view that cannot be built does not fail the others.

`/surveys/:id/results` and `report.pptx` accept `weighted=true`; results add `weighted`, `weightedBase`, `effectiveBase`, `synthetic`, `weightingAvailable`, and `coded` rows on coded open ends.

## Platform
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/security` | row-level-security posture seen by Postgres for this request |
| GET | `/admin/users` | workspace members: `{id, name, email, role, vendorId, clientId, mfaEnabled, activeSessions, lastSignIn, you}`; never password or MFA secrets |
| PATCH | `/admin/users/:id/role` | write; `{ role }`, one of the internal roles. 403 for your own role, 400 for vendor/client accounts or when removing the last platform admin. Audited as `role.changed`. Granting `platform_admin` returns `{changed: false, approvalId}`: a *Granting admin access* approval that another platform admin or an executive decides |
| POST | `/admin/users/:id/sessions/revoke` | write; revokes the member's live sessions in this workspace (not your own). Audited as `sessions.revoked` |
| GET | `/admin/audit/facets` | record types and actions in the audit trail, with counts |
| GET | `/live` | Server-Sent Events: `change` `{type}` for the workspace, `notification` `{type,module,title}` for the caller's role |
| GET | `/auth/sso/config` · `/auth/sso/start?next=` · `/auth/sso/callback` | OpenID Connect sign-in (public) |
| GET | `/metrics` | Prometheus text; requires `Authorization: Bearer $METRICS_TOKEN`, 404 otherwise |
| GET | `/integrations` | `integrations` module: `[{id, name, group, state: connected\|configured\|development\|off\|not_built, detail, settings[{name, set}], lastActivity}]`; read from server settings and recent activity, never returns secret values. The panel rows show settings only to the workspace that owns the panels |

**Headers.** Writes accept `Idempotency-Key` (8–100 of `[A-Za-z0-9_.:-]`): a retry with the same key and body returns the stored response with `Idempotent-Replayed: true`; a different body gives 422; a retry during the first request gives 409. `GET /audit`, `/comms/messages`, `/ai/usage`, `/projects`, `/clients`, `/opportunities`, `/surveys`, `/approvals`, `/invoices`, `/purchase-orders`, `/payables`, `/vendors`, `/allocations`, `/diy/requests` and `/feasibility` take `take` and `cursor` and return `X-Next-Cursor` when more rows exist (lists default to 500 rows per page). Every response has `X-Request-Id`; error bodies include `requestId`.

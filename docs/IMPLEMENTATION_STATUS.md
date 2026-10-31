# Implementation status: Phase 4

Legend: **Functional** = real logic, persisted in Postgres and enforced by the API · **Functional (client)** = real logic in the browser only · **Simulated** = fictional demo data or a stand-in for a future service, labelled in the UI · **Planned** = not built.

Seeded records are fictional. No real clients, suppliers, panelists or health data are used. No external system is connected: no email or SMS provider (messages are recorded by a development adapter and never leave the system), no accounting system or payment rail (paid means recorded), no supplier or panel-site APIs, no AI model. Panel brand names are Sampledge's; their headline metrics are simulated.

## Platform

| Capability | Status | Notes |
|---|---|---|
| Sign-in (email + password), httpOnly session cookie, revocable sessions, logout | Functional | bcrypt hashes; JWT carries only a session id checked against the `Session` table |
| TOTP two-factor (enrol, activate, challenge at sign-in) | Functional (API) | no enrolment screen in the UI yet; tested via API |
| SSO (SAML/OIDC) | Planned (Phase 6) | |
| Role-based access: module access, permissions, read-only enforcement | Functional | one matrix in `packages/core/src/roles.ts` drives both the UI and the API guards |
| Tenant isolation | Functional (application layer) | every query filters by the session's tenant; other tenants' ids return 404. Postgres RLS as a second layer is Phase 6 |
| Scoped roles (vendor sees own vendor; client sees own projects) | Functional | enforced in services from `Membership.vendorId/clientId` |
| Field redaction (margins, costs, competitor rate cards) | Functional | stripped server-side; the UI also hides the panels |
| Human approval gate (quotes, purchases, publishing, deletion, …) | Functional | requester cannot approve their own request; approving applies the effect in the same transaction |
| Audit log | Functional | every mutation writes actor, before and after |
| Rate limiting | Functional | global and per-IP sign-in limits |
| Notifications | Functional | written by the workflow worker (POs, invoices, feasibility answers, approvals, quota fills). Read state is shared per role, not per user |
| Offline demo fallback | Functional (client) | when the API is unreachable, Phase 2 behaviour with an "Offline demo" label |
| Docker compose (Postgres, API, web) | Functional | images built and the e2e test passed against the stack |
| CI workflow | Written, not yet run | no GitHub repository attached yet |
| Workflow engine: transactional outbox + worker | Functional | events are written in the same transaction as the change, so a rolled-back change never fires a side effect. The worker claims batches with `FOR UPDATE SKIP LOCKED` and a 30 s lease, retries up to 5 times and records the last error. Runs inside the API by default or as a separate process (`node dist/worker.js`, `WORKER_INLINE=false`). Postgres instead of Redis: one less moving part at this scale; the claim query is the swap point |
| Live push (WebSocket) | Planned (Phase 5) | UI refreshes after each action |

## Command Center
| Feature | Status |
|---|---|
| 14 KPI cards: animated values, sparklines, deltas, status, tooltips, drill-down, refresh state, role redaction | Values computed from API records; prior-period deltas and sparklines simulated. `GET /dashboard/summary` returns database KPIs |
| 3D globe: land from Natural Earth, pillars per country, supply arcs, fly-to, country panel, 2D fallback | Functional rendering; country figures computed from project + vendor records |
| Globe time scrubber (4th dimension) | Weekly history simulated (labelled) |
| Research operations flow (11 stages) with project, owner, status, blocker drill-down and advance action | Functional |
| AI executive assistant | Functional rule-based router over records with sources; **no LLM connected**; says when data is missing |
| Revenue / fieldwork charts | Simulated series |

## Projects
| Feature | Status |
|---|---|
| Kanban with drag-and-drop stage changes, Gantt timeline, list | Functional (stage changes persisted and audited) |
| Project drawer: lifecycle stepper, quotas rings, budget, suppliers, blockers, activity | Functional |
| AI project manager: deadline risk, low quotas, cost overruns | Functional rules, traceable to records |
| Filters and search | Functional |

## Bidding CRM
| Feature | Status |
|---|---|
| Pipeline board with drag-and-drop; Won → creates the project in the same transaction; Lost requires a reason | Functional |
| New RFQ form | Functional (persisted) |
| Email-to-RFQ requirement extraction | Functional (regex parser); AI extraction Phase 5 |
| AI bid assistant: eligible vendors, CPI comparison, 3 price options with margin, sample plan, draft quote | Functional on rate-card **estimates**, labelled as not supplier-confirmed |
| Funnel, forecast, win/loss charts | Functional on demo records; forecast months simulated |
| Quotes: draft (API), submit → approval → sent | Functional in the API. Pricing uses the lowest answered supplier CPI per market (`supplier_confirmed`), falling back to rate cards per market (`mixed` / `rate_card_estimate`, labelled). The approved quote is emailed to the client through the development adapter. The CRM screen still builds its what-if price options client-side |
| Supplier feasibility: request from the opportunity drawer, answers shown per vendor and market | Functional (see Vendor Portal) |

## Sample Exchange
| Feature | Status |
|---|---|
| Explainable AI vendor selection with adjustable weights and allocation | Functional (weighted scoring model, not ML) |
| Coverage heatmap, vendor radar, sankey allocation, CPI vs quality, leaderboard | Functional on demo vendors |
| Vendor role workspace hides competitors' data | Functional (the API returns only the vendor's own record) |
| PO request | Functional: creates allocation proposals pending a purchase approval. Approval raises a purchase order, a payable and a vendor email (development adapter) |

## Panels
| Feature | Status |
|---|---|
| Three brand identities, KPIs, funnel, pyramid, quality, engagement, cohort retention | Simulated metrics |
| Configurable reward categories, thresholds, frequency cap | Functional form; saving is a draft toast |
| Panelist directory: 3,000 synthetic pseudonymous members, filters, paging, consent history, consent withdrawal, deletion via approval | Functional |
| Healthcare safeguards, automation list | Design + policy description |
| CSV member import: dry-run validation, then import; rejects rows containing an email address or phone number; skips existing handles; up to 5,000 rows | Functional |
| Integration with existing panel sites | Planned (Phase 6 adapters); we do not assume APIs exist |

## Survey Studio
| Feature | Status |
|---|---|
| Survey engine: display logic, branching, terminate/screen-out, quotas & overquota, seeded randomisation with anchored exclusives, piping, validation, versioning | **Functional, unit-tested** (`npm test`) |
| Visual logic builder (React Flow): zoom, pan, search, collapse blocks, connect to create rules, delete rules, inspector edits | Functional; each edit is saved as a new immutable server version (stale edits are refused) |
| Preview: mobile/desktop, language switch, execution trace, live quota counters, response recording | Functional |
| Automated QA: reference integrity, missing options, backward jumps, translation gaps, reachability via simulated journeys, completion path; approve fixes | Functional |
| AI programming assistant: randomise, add quotas, translation slots, routing check, mobile split; diff + apply + undo | Functional rule-based; no LLM; translations are placeholders |
| Questionnaire import: TXT/CSV parse → review → draft (never publishes) | Functional for text; Word/PDF/Excel Phase 5 |
| Advanced methods (MaxDiff, conjoint, Van Westendorp, Gabor-Granger, TURF) | Planned Phase 5 with valid designs; not simulated |

## Survey runtime (new)
| Feature | Status |
|---|---|
| Public respondent page `/r/:surveyId` (mobile-first) | Functional |
| Server-held session, per-answer validation, routing, piping, seeded option order | Functional (same engine as the studio) |
| Atomic quota counting on completion; full cells terminate as overquota as soon as they are determined | Functional, race-tested (4 concurrent respondents, 1 slot) |
| Staff preview (`?preview=1`) never counts toward quotas | Functional |
| Publishing blocked while QA reports critical issues; published only after approval | Functional |
| Responses by outcome and source (`GET /surveys/:id/responses`), CSV export (`responses.csv`, linked from the studio) | Functional |
| Respondent fraud checks, device fingerprinting, supplier redirects | Planned (Phase 5) |

## Insight Studio
| Feature | Status |
|---|---|
| Respondent dataset (n=1,200) | Simulated |
| Weighting, effective base, crosstabs, column-letter significance (z-test), CSV export | Functional statistics |
| k-means segmentation with 3D and 2D views | Functional |
| Sankey journey, NPS distribution, wave trend | Functional on simulated data |
| Editable narrative | Template-generated from computed figures, labelled AI-assisted draft |
| Presentation view | Functional |
| PPTX/PDF report generation | Planned Phase 5 |

## AI Automation
| Feature | Status |
|---|---|
| Workflow editor: add/connect/delete nodes, inspector, retry policy, validation (approval required upstream of consequential actions), versioned save, animated dry-run | Functional (client-side) |
| Approval queue with permission-checked approve/reject | Functional: decisions persist and apply their effect (publish survey, approve allocation → PO, send quote, pay vendor, release a high-volume send, delete panelist) |
| Agent toggles, cost caps | Toggles persisted; usage figures simulated; agents do not run |
| Execution log, reliability chart | Simulated |

## Finance (new)
| Feature | Status |
|---|---|
| Draft invoice when a project reaches the Invoice stage (worker), or on demand | Functional |
| Issue invoice (terms, due date, client email), mark received | Functional. Clients see issued invoices only |
| Purchase orders and payables raised on approved sample purchases | Functional. Vendors see their own; roles without `view:vendor_bids` see none |
| Vendor payment: request → *Issuing payments* approval (not the requester) → paid | Functional as a record. No payment rail or accounting system is connected |
| Receivable, overdue, collected, payable and paid-out KPIs | Functional, computed from records |
| Multi-currency, incentives ledger, reconciliation, forecast vs actuals | Planned (Phase 5) |

## Comms Hub (new)
| Feature | Status |
|---|---|
| Compose to a client, vendor, panel segment or internal team; templates; recipient preview | Functional |
| Consent filtering: panel sends exclude members who withdrew marketing consent, suspended or pending deletion | Functional, tested |
| High-volume gate: more than `COMMS_HIGH_VOLUME` (default 100) recipients needs a *High-volume communications* approval | Functional, tested |
| Delivery log with status for every message, including workflow messages | Functional |
| Delivery | **Development adapter only**: messages are recorded as `delivered_dev`, nothing is sent. Email/SMS providers plug in behind the same adapter interface (Phase 6). Per-member placeholder merge arrives with a real adapter |
| Vendors and clients can message the internal team only | Functional, tested |

## Vendor Portal (new)
| Feature | Status |
|---|---|
| Feasibility inbox: brief (audience, market, n, IR, LOI, due date), no client identity, `RFQ-` reference | Functional |
| Answer with CPI and capacity, or decline. Only the vendor can answer its own request | Functional, tested |
| Allocations, purchase orders and payment status | Functional, scoped to the vendor |

## Client Portal (new)
| Feature | Status |
|---|---|
| Own projects with stage, completes vs target and deadline; no costs, margins or vendors | Functional |
| Sign-offs waiting on the client (survey publish approvals on own projects) | Functional |
| Issued invoices and correspondence; message the project team | Functional |
| Deliverables and report downloads | Planned (Phase 5) |

## Other modules
Data Processing, DIY Research, Integrations and Admin & Security are navigable placeholders that state their scope and role access. No functionality is simulated on them.

## Known limitations
- Insight Studio still analyses a simulated respondent dataset; it does not read survey responses yet (Phase 4).
- The CRM quote builder and Survey Studio QA run in the browser; the API has equivalent endpoints, used for persistence and enforcement.
- Notification read state is per role, not per user.
- Lists are not cursor-paginated yet except panelists; fine for demo volumes.
- Finance, Comms Hub and both portals need the live API; in the offline demo they say so instead of simulating records.
- The account switcher signs in with the seeded demo password. Turn it off with `NEXT_PUBLIC_DEMO_LOGINS=false`.
- The 3D globe needs WebGL; without it the 2D map is shown automatically.
- Logo is a placeholder wordmark because no official asset was provided.

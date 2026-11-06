# Implementation status: v0.11.0 and later (Phases 1–6, known-limitation fixes, reports and exports, scale-out and AI evaluation, panel backend adapter and project sync, Admin & Security, Integrations, SMTP and SMS delivery, SAML, list paging, supplier redirects, client deliverables and scheduled delivery, retention and workspaces, finance ledgers)

Connecting the outside services is covered step by step in [SETUP_GUIDE.md](SETUP_GUIDE.md); the latest security review is [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

Legend: **Functional** = real logic, persisted in Postgres and enforced by the API · **Functional (client)** = real logic in the browser only · **Simulated** = fictional demo data or a stand-in for a future service, labelled in the UI · **Planned** = not built.

Seeded records are fictional. No real clients, suppliers, panelists or health data are used. No external system is connected unless an operator configures it: e-mail goes out only with SMTP settings and SMS only with an SMS provider's settings (otherwise messages are recorded by a development adapter and never leave the system), no accounting system or payment rail (paid means recorded), no supplier or panel-site APIs. AI runs in rule-based mode unless an operator sets `AI_PROVIDER=anthropic` and an API key; the Claude path is tested against a local stub server, not against the live API. Panel brand names are Sampledge's; their headline metrics are simulated.

## Platform

| Capability | Status | Notes |
|---|---|---|
| Sign-in (email + password), httpOnly session cookie, revocable sessions, logout | Functional | bcrypt hashes; JWT carries only a session id checked against the `Session` table |
| TOTP two-factor (enrol, activate, move to a new device, turn off, challenge at sign-in) | Functional, tested | **Your account** page (key icon in the top bar) with QR code; changing device or turning it off needs a current code |
| SSO: OpenID Connect (authorization code + PKCE, signed ID token, nonce, state) | Functional, tested against a local stub provider only | users must already belong to the workspace |
| SSO: SAML 2.0 (SP-initiated, signed assertions, issuer, audience, time window, InResponseTo, one-time use, same-browser finish) | Functional, tested against a stand-in provider only | users must already belong to the workspace; no single logout or encrypted assertions; request IDs shared across API instances in Postgres |
| Role-based access: module access, permissions, read-only enforcement | Functional | one matrix in `packages/core/src/roles.ts` drives both the UI and the API guards |
| Tenant isolation | Functional, two layers | every query filters by the session's tenant, and Postgres row-level security (forced on all 33 tenant tables) refuses other tenants' rows for signed-in requests even without a filter. Tested; visible at `GET /admin/security` |
| Scoped roles (vendor sees own vendor; client sees own projects) | Functional | enforced in services from `Membership.vendorId/clientId` |
| Field redaction (margins, costs, competitor rate cards) | Functional | stripped server-side; the UI also hides the panels |
| Human approval gate (quotes, purchases, publishing, deletion, …) | Functional | requester cannot approve their own request; approving applies the effect in the same transaction |
| Audit log | Functional | every mutation writes actor, before and after |
| Rate limiting | Functional, shared across instances | global and per-IP sign-in limits; counters live in Postgres (`RateLimitBucket`, one atomic upsert per request) so several API instances enforce one limit. `TRUST_PROXY` makes limits use the client address behind a load balancer |
| Notifications | Functional | written by the workflow worker (POs, invoices, feasibility answers, approvals, quota fills). Read state is shared per role, not per user |
| Offline demo fallback | Functional (client) | when the API is unreachable, Phase 2 behaviour with an "Offline demo" label |
| Docker compose (Postgres, API, web) | Functional | images built and the e2e test passed against the stack |
| CI workflow | Written, in the repository; first run happens on the pull request | |
| Workflow engine: transactional outbox + worker | Functional | events are written in the same transaction as the change, so a rolled-back change never fires a side effect. The worker claims batches with `FOR UPDATE SKIP LOCKED` and a 30 s lease, retries up to 5 times and records the last error. Runs inside the API by default or as a separate process (`node dist/worker.js`, `WORKER_INLINE=false`). Postgres instead of Redis: one less moving part at this scale; the claim query is the swap point |
| Live updates | Functional: Postgres NOTIFY on commit → Server-Sent Events, filtered by tenant and role; screens refresh and role notifications toast. Tested in the API and in the browser |
| Idempotency keys on writes | Functional: the web client sends one on every write and retries once after a dropped connection; replays return the first response |
| Cursor paging | Functional on audit log, messages and AI usage (`X-Next-Cursor`); other lists are small and unpaged |
| Security headers | API: CSP `default-src none`, no framing, nosniff. Web: CSP (scripts need `unsafe-inline` for Next bootstrap), Permissions-Policy, COOP, optional HSTS |
| Observability | Request ids, JSON access logs, Prometheus metrics. No tracing backend connected |
| Integrations page (`/integrations`) | Functional: one honest list of every outside system (three panels, Claude, SSO, email/SMS, accounting, storage/BI, metrics) with its real state from the API server's settings and last activity. Shows whether each setting is present, never its value |
| Backup and restore | Scripts written and a round trip verified in the build container |
| Load test | Script and measured runs on one and two instances (see DEPLOYMENT.md); not a sizing guarantee | |
| Several API instances + separate worker | Functional, verified: `scripts/multi-instance-check.mjs` (15 checks: sessions, sign-out, idempotency replay, outbox processed by the separate worker, live updates across instances, shared sign-in limit) passes locally and runs in CI on every pull request against two API processes and a separate worker | no sticky sessions needed |
| Turn2Opinion panel backend adapter | Built; tested against a local stand-in only; **not connected** until each panel's URL and app token are set | per-panel tokens, connection check, CPI quote, filter options, feasibility count, project status; invites, soft launch and cancel behind approvals and sent at most once by the worker. Request and response formats not in the backend's description are passed through unchanged, not guessed. See docs/integrations/TURN2OPINION.md |
| Panel project sync and response import | Built; tested against a local stand-in of the panel's Sampledge routes only; **not connected** | project → markets and quotas (gender, age and region conditions translate; others need filters from a person), reach check, live panel status, paged idempotent response import into `PanelResponse` (pseudonymous fields only), optional periodic import in the worker. Syncing sends no invitations |
| AI evaluation set | Functional for the rule-based implementations; ready for Claude | 17 synthetic cases across the 4 AI tasks with 109 field-level checks, critical checks for guessed numbers, invented facts and followed injections. Rules: 16/17 cases, 0 critical failures (the miss: an unsupported market is dropped without being reported). Model scores not yet measured: needs `ANTHROPIC_API_KEY`. Admin view on the Automation page; CLI `node dist/ai/evals/run.js --provider anthropic` |

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
| Integration with existing panel sites | Functional adapter and project sync (v0.10–v0.11), tested against stand-ins only; see Panels below and docs/integrations/TURN2OPINION.md |
| SAMPLEON eligibility & delivery API: attribute catalogue, eligible/reachable counts, selection, checks, survey cards, panel card feed, participation and rewards from SAMPLEON events | Functional; tested in `sampleon.test.ts` and end to end with SAMPLEON, ZAPX and PROJEXA; see docs/integrations/SAMPLEON.md |

## Survey Studio
| Feature | Status |
|---|---|
| Survey engine: display logic, branching, terminate/screen-out, quotas & overquota, seeded randomisation with anchored exclusives, piping, validation, versioning | **Functional, unit-tested** (`npm test`) |
| Visual logic builder (React Flow): zoom, pan, search, collapse blocks, connect to create rules, delete rules, inspector edits | Functional; each edit is saved as a new immutable server version (stale edits are refused) |
| Preview: mobile/desktop, language switch, execution trace, live quota counters, response recording | Functional |
| Automated QA: reference integrity, missing options, backward jumps, translation gaps, reachability via simulated journeys, completion path; approve fixes | Functional |
| AI programming assistant: randomise, add quotas, translation slots, routing check, mobile split; diff + apply + undo | Functional rule-based; no LLM; translations are placeholders |
| Questionnaire import: TXT/CSV parse → review → draft (never publishes) | Functional for text; Word/PDF/Excel Phase 5 |
| Advanced methods (MaxDiff, conjoint, Van Westendorp, Gabor-Granger, TURF) | Functional engines (Phase 5); see the Methods lab row below |

## Survey runtime (new)
| Feature | Status |
|---|---|
| Public respondent page `/r/:surveyId` (mobile-first) | Functional |
| Server-held session, per-answer validation, routing, piping, seeded option order | Functional (same engine as the studio) |
| Atomic quota counting on completion; full cells terminate as overquota as soon as they are determined | Functional, race-tested (4 concurrent respondents, 1 slot) |
| Staff preview (`?preview=1`) never counts toward quotas | Functional |
| Publishing blocked while QA reports critical issues; published only after approval | Functional |
| Responses by outcome and source (`GET /surveys/:id/responses`), CSV export (`responses.csv`, linked from the studio) | Functional |
| Quality flags at completion (speed, straight-lining, duplicates, gibberish) | Functional (Phase 5) |
| Supplier entry and exit: entry link per allocation (`?a=<allocation>&rid=<supplier id>`), https exit links per outcome set by the vendor or the team, supplier id returned URL-encoded | Functional |
| Duplicate-device check: a random first-party cookie, stored only as a keyed per-survey hash; a second complete from the same browser is flagged `duplicate_device` for review, never blocked | Functional. No fingerprinting from IP, user agent or device traits, by design |

## Insight Studio
| Feature | Status |
|---|---|
| **Survey results from recorded responses**: frequencies, numeric summaries, NPS, matrix distributions, open-end verbatims | Functional (API), tested. Excludes staff previews and rejected interviews |
| Banner (crosstab by a single-choice question) with column-letter significance (two-proportion z, 95%, n ≥ 30 per column) | Functional |
| Include or exclude quality-flagged interviews | Functional |
| **PowerPoint report** (title slide with base and exclusions, one slide per question: bar charts, banner tables, NPS, matrix, verbatims) | Functional, tested. Every figure comes from the results computation |
| **Respondent quality flags** at completion: speeder (< ⅓ of LOI, min 60 s), straight-liner (matrix with 4+ rows), duplicate respondent reference, gibberish open end | Functional, tested. Flags never remove anyone |
| Respondent rejection: request → *Rejecting respondents* approval (not the requester) → excluded from results and its quota place released | Functional, tested |
| **Methods lab**: MaxDiff (balanced design + counting scores), choice-based conjoint (level-balanced design + aggregate MNL part-worths, importances, share simulator), Van Westendorp, Gabor-Granger, TURF (exhaustive or greedy) | Functional engines in `packages/core`, unit-tested. The lab runs them on **simulated respondents**, labelled as such. Hierarchical Bayes is not implemented |
| **Respondent flow (Sankey)** between any two single-choice or NPS questions (NPS grouped into promoters, passives, detractors), weighted when weighting is on | Functional (API + UI), tested. Computed from recorded completes |
| **Fieldwork trend**: completes per day or week of completion, with NPS, a mean, or the share choosing an answer per period | Functional, tested |
| **Segmentation**: weighted k-means (k = 2–5) on standardised rating, NPS and numeric answers, segment profiles (largest differences from the total), 2D map on the first two principal components, share of variance explained | Functional, tested. A starting point for analysis, not a validated typology |
| Demo dataset view (n=1,200): weighting, k-means segmentation, 3D/2D views, Sankey, trends, narrative, presentation | Simulated data, functional statistics (unchanged from Phase 2) |
| **PDF report**: the PowerPoint report's content (title page with base, weighting and exclusions; every question with bars or banner tables; coded open ends and verbatims) as an A4 PDF with page footers | Functional, tested. Standard PDF fonts (Latin-1); other characters are replaced |
| Scheduled report delivery | Functional: daily or weekly (UTC) release of a survey's PDF/PowerPoint report or Excel tables to the client, run by the worker on the owner's current access; the client gets a Comms Hub e-mail (SMTP when configured, otherwise the development adapter). Respondent-level data cannot be scheduled |

## AI gateway (new)
| Feature | Status |
|---|---|
| Provider-independent task registry: versioned prompt, typed output schema, rule-based implementation per task | Functional |
| Tasks: RFQ e-mail → requirements; questionnaire text → structured draft questions; project status summary with risks | Functional in rule-based mode (default) |
| Claude provider (`AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`), model `claude-opus-5-5` with server-side fallback models enabled, structured output | Implemented and tested against a stub server only. **Not exercised against the live Anthropic API** in this build |
| Fallback to rules on refusal, invalid output, provider error or spent monthly cap (`AI_MONTHLY_CAP_USD`, default $50) | Functional, tested |
| Every call logged (task, provider, model, status, tokens, cost, duration) and shown to admins | Functional |
| Cost facts reach the model only for roles with `view:margins` | Functional, tested |
| Document text extraction: Word (.docx), Excel (.xlsx), PDF with a text layer, plain text; 8 MB limit; file signature checked | Functional, tested with fixtures. Scanned PDFs (OCR) are not supported |
| AI output is a draft: nothing is created, sent or published without the existing approvals | By design |

## AI Automation
| Feature | Status |
|---|---|
| Workflow editor: add/connect/delete nodes, inspector, retry policy, validation (approval required upstream of consequential actions), versioned save, animated dry-run | Functional (client-side) |
| Approval queue with permission-checked approve/reject | Functional: decisions persist and apply their effect (publish survey, approve allocation → PO, send quote, pay vendor, release a high-volume send, delete panelist) |
| AI gateway panel: provider, month spend vs cap, registered tasks, recent calls | Functional (live API) |
| Agent toggles, cost caps | Toggles persisted; agent usage figures simulated; the twelve agents do not run autonomously |
| Execution log, reliability chart | Simulated |

## Finance (new)
| Feature | Status |
|---|---|
| Draft invoice when a project reaches the Invoice stage (worker), or on demand | Functional |
| Issue invoice (terms, due date, client email), mark received | Functional. Clients see issued invoices only |
| Purchase orders and payables raised on approved sample purchases | Functional. Vendors see their own; roles without `view:vendor_bids` see none |
| Vendor payment: request → *Issuing payments* approval (not the requester) → paid | Functional as a record. No payment rail or accounting system is connected |
| Receivable, overdue, collected, payable and paid-out KPIs | Functional, computed from records |
| Multi-currency | Functional, tested. Base currency per workspace (fixed once invoices or POs exist); rates entered by finance (no market feed); clients invoiced and vendors ordered in their own currency at the rate fixed on each document; a currency without a rate falls back to the base. Totals convert at each document's rate |
| PO reconciliation | Functional, tested. Ordered completes against completes Sampledge recorded from the vendor (usable, vendor-sourced responses) and the count finance accepts; a shortfall needs a reason and lowers the open payable before payment, then closes the PO. Paid or approval-pending payables cannot be reconciled down |
| Incentives ledger | Functional, tested. Points earned, expired, adjusted (signed, with a reason) and redeemed per panel member, valued at the workspace's point value; liability = outstanding points × value. A redemption is an *Issuing payments* approval (not the requester) and its points are reserved meanwhile. No reward provider is connected: posted means recorded |
| Forecast vs actuals | Functional, tested. By month (six back, three ahead) and by project: planned revenue and cost (target × sell and cost CPI, in the deadline month) against invoiced revenue and ordered cost after reconciliation, in the base currency |

## Comms Hub (new)
| Feature | Status |
|---|---|
| Compose to a client, vendor, panel segment or internal team; templates; recipient preview | Functional |
| Consent filtering: panel sends exclude members who withdrew marketing consent, suspended or pending deletion | Functional, tested |
| High-volume gate: more than `COMMS_HIGH_VOLUME` (default 100) recipients needs a *High-volume communications* approval | Functional, tested |
| Delivery log with status for every message, including workflow messages | Functional |
| Delivery | **Development adapter by default**: messages are recorded as `delivered_dev`, nothing is sent. **SMTP e-mail** when `SMTP_HOST` and `SMTP_FROM` are set: e-mail to client and vendor accounts and internal roles is sent once, each address as a blind copy (`sent`); a refused send is `failed` with the server's reason and is not retried. **SMS** when `SMS_ACCOUNT_SID`, `SMS_AUTH_TOKEN` and `SMS_FROM` are set: one request per phone number to a Twilio-compatible API (`SMS_API_URL`); numbers are per workspace membership, set by an administrator in Admin & Security (audited with only the last four digits); bodies up to 1,600 characters; `sent` if any number was accepted, with the refused count noted, `failed` if all were refused. Panel messages, in-app messages and a channel without a provider stay `not_sent` with the reason: panelists are pseudonymous here. Tested against a local SMTP server and a local stand-in SMS API, not hosted providers |
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
| Deliverables: the team releases a survey's PDF or PowerPoint report or Excel tables (straight away) or respondent-level CSV/SPSS data (after a *Releasing sensitive datasets* approval by someone else). Generated once at release and stored with SHA-256; clients download only released files on their own projects; downloads audited and counted; withdraw at any time; the client is notified through the Comms Hub | Functional |

## DIY Research (new)
| Feature | Status |
|---|---|
| Configure audience, markets, completes, incidence and LOI; indicative per-market and total range from rate cards (±15%), no supplier names or costs | Functional, tested. Labelled "Indicative pricing, not a quote" |
| Submit (client users only) → CRM opportunity in *New RFQ* with channel `diy`; Business Development and executives notified | Functional, tested |
| Client-facing request status (Received, Being reviewed, Quote sent, …) without margins or owners | Functional |
| Self-service questionnaire building and launch | Planned (Phase 6): fielding stays with the research team and its approvals |

## Data Processing (new)
| Feature | Status |
|---|---|
| Fielding summary: completes, screen-outs, flags, rejections, median length | Functional |
| Rim weighting (raking) to target shares on any single-choice questions; weight cap 0.2–5; efficiency, effective base and achieved shares; remove weighting | Functional, tested. Results, PowerPoint and tables use weights on request; significance uses the effective base |
| Open-end codeframes: suggested by the AI gateway (rules by default), edited by a coder; keyword first pass over every answer; manual codes that survive recoding | Functional, tested |
| Excel tables: every question against a banner, weighted or not, with significance letters and a notes sheet | Functional, tested |
| Demo dataset: 600 **synthetic** interviews on the closed "CX Benchmark Telecom" survey, labelled in every screen and export | Synthetic, generated from fixed probabilities |
| **Recodes**: derived single-choice variables that group answers of a single-choice or NPS question (e.g. top-2 box) or cut a numeric/NPS answer into bands; validated against the questionnaire; usable as banners and in results, flow, tables, PowerPoint, PDF and SPSS | Functional, tested. Answers are never changed; recodes are computed when read |
| **SPSS export (.sav)**: one case per usable complete with variable and value labels, long names, UTF-8, multi-choice/matrix/ranking split into variables, recodes, coded open ends as 0/1, completion datetime, and the rim weight set as the file weight | Functional, tested; verified with an independent reader (pyreadstat). Written by Sampledge's own writer, uncompressed |

## Other modules
| Admin & Security feature | Status | Notes |
|---|---|---|
| Security posture: row-level security, database role, SSO and two-step sign-in coverage | Functional | Read from Postgres on each visit (`GET /admin/security`), not from configuration |
| People and roles: members, role, two-step state, active sessions, last sign-in | Functional, tested | Platform admins change internal roles; vendor and client accounts keep theirs; nobody changes their own role, so a workspace always keeps a platform admin. Granting Platform Admin is an approval decided by someone else. Audited |
| Sign out everywhere | Functional, tested | Revokes a member's live sessions in this workspace; audited |
| Audit trail viewer with record type, action and actor filters | Functional, tested | Append-only; written in the same transaction as each change |
| Role matrix | Functional | The same matrix the API guards use |
| Workspace settings: name, identifier, what the workspace holds | Functional, tested | Renaming is audited. Counts come from this workspace only |
| Data retention policies | Functional, tested | Per workspace, per category (message content, notifications, ended sessions, AI usage log, panel request log), default keep, with a minimum period each. Turning one on or shortening it is a *Deleting records* approval decided by someone else; lengthening or turning off applies at once. The worker applies them daily; admins can run them now. Message content is redacted and the log row kept; the others are deleted. Every run is audited with counts. Research data, finance records and the audit trail are not covered |
| Workspace (tenant) creation | Functional, tested | Operator command on the server (`node dist/tenant.js create|list`): creates the workspace and its first platform admin with a one-time password. Not available from inside a workspace |

## Known limitations
- SSO (OpenID Connect and SAML), the Claude provider, SMTP, SMS and the panel backend are tested against local stand-ins only. Each needs a check in staging with real credentials (see SETUP_GUIDE.md).
- A few API dependency advisories remain open (multer, image-size, exceljs's archiver chain): they affect code paths the app does not use or have no non-breaking fix. Each is assessed in SECURITY_REVIEW.md.
- Public respondent routes and sign-in run as the system only until they resolve the workspace (the survey or the membership); from then on the database enforces that tenant. The worker handles each event as its tenant. The first lookup on those routes (survey or response by id, user by e-mail) is still unscoped by design.
- The CRM bid assistant and Survey Studio import call the AI gateway when signed in; offline they use the same rules in the browser.
- The CRM quote builder and Survey Studio QA run in the browser; the API has equivalent endpoints, used for persistence and enforcement.
- List endpoints return up to 500 rows per page by default (cursor paging with `take`/`cursor` and `X-Next-Cursor`). The web app loads every page of projects, opportunities, vendors, surveys and clients (up to 5,000 each) and shows "Load more" on the audit trail, Comms Hub messages and Finance lists.
- Finance, Comms Hub and both portals need the live API; in the offline demo they say so instead of simulating records.
- The account switcher signs in with the seeded demo password. Turn it off with `NEXT_PUBLIC_DEMO_LOGINS=false`.
- The 3D globe needs WebGL; without it the 2D map is shown automatically.
- Logo is a placeholder wordmark because no official asset was provided.

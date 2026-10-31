# Development roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 · Architecture & design system** ✅ | Architecture, data model, module comms, API contracts, role matrix, tokens, component library, navigation, wireframes | Docs in `docs/`, `/design-system` live |
| **2 · Visual prototype** ✅ | Command Center, Survey Studio, Sample Exchange, Panels, CRM, Projects, Insight Studio, AI Automation on labelled demo data | Reviewed |
| **3 · Functional core** ✅ | NestJS API, Postgres/Prisma migrations + seed, auth (password, TOTP MFA, revocable sessions), RBAC guards, tenant scoping, field redaction, projects, clients, vendors, allocations, quotes, surveys + versions, respondent runtime, responses, atomic quotas, panelists + consent, approvals, audit log, Docker compose | 34 API integration tests incl. tenant and role isolation; 13-step browser e2e on the production build and on the compose stack; UI reads and writes via the API |
| **4 · Integrated workflow** ✅ | Transactional outbox + worker (Postgres, `SKIP LOCKED`), supplier feasibility (CRM request → vendor portal answer → supplier-confirmed quote), Finance (POs and payables on approved purchases, invoices at the Invoice stage, approval-gated vendor payments), Comms Hub (templates, consent filtering, high-volume approval, development delivery adapter), client and vendor portals, panel CSV import, responses CSV export | 58 API tests (24 new workflow tests); 20-step browser e2e covering CRM → vendor → finance → client → comms on the production build |
| **5 · AI and analytics** ✅ | Provider-independent AI gateway (rules by default, Claude optional, schema-checked output, monthly cap, call log), questionnaire import from Word/Excel/PDF, RFQ extraction, project status summaries, survey results from recorded responses with banners and significance, PowerPoint report, respondent quality flags and approval-gated rejection, advanced methods engines (MaxDiff, conjoint, Van Westendorp, Gabor-Granger, TURF), DIY research requests | 76 API tests + 17 method/engine unit tests; 30-step browser e2e on the production build. AI provider path tested against a stub server |
| **6 · Enterprise readiness** ✅ | Postgres row-level security, OpenID Connect SSO, Data Processing (weighting, coding, tables), live updates (NOTIFY → SSE), idempotency keys, cursor paging, security headers, request ids, JSON logs, Prometheus metrics, backup/restore scripts, load test, deployment guide and runbook | 92 API tests + 24 engine tests; 33-step browser e2e; restore round trip; measured load test |
| Next | SAML, Integrations (panel and e-mail/SMS adapters), PDF reports, recodes and SPSS export, live AI evaluation set, external pen test, multi-instance load test | |

## Decisions in Phase 4
- **Postgres outbox instead of Redis.** Events commit with the change that caused them, and the worker claims them with `FOR UPDATE SKIP LOCKED`. This removes a service and a failure mode; the claim function is the single place to swap in a broker if volume calls for it.
- **Only vendors confirm feasibility.** Internal users cannot enter a supplier answer, and the seed contains open requests but no answers, so a `supplier_confirmed` quote always traces to a vendor's own response.
- **Delivery is a development adapter.** Every outbound message is a stored record with a status. Real providers are adapters in Phase 6; nothing is presented as sent.

## Decisions in Phase 5
- **Rules first, model optional.** Every AI task has a deterministic implementation, so the platform works with no model and degrades to it on any provider problem. A model's output must pass the task's schema before it is used, and it is always a draft behind the existing approvals.
- **One model call per task, server-side.** Keys and data never reach the browser; costs are logged per call and capped per tenant per month.
- **Aggregate estimation, stated plainly.** MaxDiff uses counting scores and conjoint an aggregate logit. Hierarchical Bayes is not claimed.
- **Flags inform, people decide.** Quality checks flag interviews; removing one is a *Rejecting respondents* approval that also releases its quota place.
- **DIY creates a request, not a project.** Clients get an indicative range and a tracked request; the team confirms with suppliers before any quote.

## Decisions in Phase 6
- **RLS as a backstop, not the only check.** Services keep their tenant filters; the database refuses other tenants' rows when a filter is missing. System work (worker, sign-in, public respondent links) runs without a tenant scope and is covered by its own filters and tests.
- **Server-Sent Events over WebSockets.** Updates flow one way; SSE passes through the Next proxy and reconnects by itself. Postgres NOTIFY carries events between processes, so it works with a separate worker or several API instances.
- **SSO does not create users.** Access is granted in Sampledge; the identity provider only proves who someone is.

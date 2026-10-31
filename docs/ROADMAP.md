# Development roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 · Architecture & design system** ✅ | Architecture, data model, module comms, API contracts, role matrix, tokens, component library, navigation, wireframes | Docs in `docs/`, `/design-system` live |
| **2 · Visual prototype** ✅ | Command Center, Survey Studio, Sample Exchange, Panels, CRM, Projects, Insight Studio, AI Automation on labelled demo data | Reviewed |
| **3 · Functional core** ✅ | NestJS API, Postgres/Prisma migrations + seed, auth (password, TOTP MFA, revocable sessions), RBAC guards, tenant scoping, field redaction, projects, clients, vendors, allocations, quotes, surveys + versions, respondent runtime, responses, atomic quotas, panelists + consent, approvals, audit log, Docker compose | 34 API integration tests incl. tenant and role isolation; 13-step browser e2e on the production build and on the compose stack; UI reads and writes via the API |
| 4 · Integrated workflow | Event-driven hand-offs (outbox + Redis queue), Comms Hub (email/SMS adapters behind approval), Finance (POs, invoices, vendor payables), client & vendor portals, DIY marketplace, report exports (PPTX/PDF), panel CSV import, supplier feasibility requests | End-to-end scenario runs on real persistence with queued side effects |
| 5 · AI automation | Provider-independent AI gateway, questionnaire import (docx/pdf/xlsx), AI survey creation, QA agent, feasibility support, project summaries, analysis assistance, advanced methods (MaxDiff, conjoint, pricing, TURF) | Evals per prompt; cost caps; approvals |
| 6 · Enterprise readiness | Postgres row-level security as a second isolation layer, SSO (SAML/OIDC), security hardening, load tests, observability, panel integration adapters, backup/recovery, deployment docs | Pen test, SLOs, runbooks |

## Carried from Phase 3 into Phase 4
- Panel member CSV import (the directory schema and consent model are in place).
- Live push (WebSocket) of quota counters; the UI refreshes after each action today.
- Cursor pagination on large lists (projects, opportunities); panelists already paginate.

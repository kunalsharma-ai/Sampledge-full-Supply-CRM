# Development roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 · Architecture & design system** ✅ | Architecture, data model, module comms, API contracts, role matrix, tokens, component library, navigation, wireframes | Docs in `docs/`, `/design-system` live |
| **2 · Visual prototype** ✅ | Command Center, Survey Studio, Sample Exchange, Panels, CRM, Projects, Insight Studio, AI Automation; navigable, interactive, demo data labelled | This build. **Review checkpoint** |
| 3 · Functional core | NestJS API, Postgres/Prisma migrations + seed, auth (password + SSO-ready, MFA), RBAC guards + RLS, projects, clients, vendors, surveys + versions, respondent runtime, responses, quotas (atomic), bids, panelists, permissions, Docker compose | API passes contract tests; tenant isolation tests green; UI reads/writes via API |
| 4 · Integrated workflow | CRM → Projects → Survey Studio → Exchange → Panels → Analytics → Finance on events; Comms Hub; Finance (quotes, POs, invoices); client & vendor portals; DIY marketplace; reporting exports | End-to-end scenario runs on real persistence |
| 5 · AI automation | AI gateway (provider-independent), questionnaire import (docx/pdf/xlsx), AI survey creation, survey QA agent, feasibility support, project summaries, analysis assistance, advanced methods (MaxDiff, conjoint, pricing, TURF) | Evals per prompt; cost caps; approvals |
| 6 · Enterprise readiness | Security hardening, load + E2E tests, observability, panel integration adapters, backup/recovery, deployment docs | Pen test, SLOs, runbooks |

## Suggested first Phase 3 slice
1. Postgres + Prisma migration from `prisma/schema.prisma`, seed from `src/lib/demo/data.ts`.
2. Move `src/lib/survey/engine.ts` into `packages/survey-engine`, used by both API and web.
3. Respondent runtime endpoint with atomic quota increments.
4. Swap the Zustand store's actions for API calls one module at a time (Projects first).

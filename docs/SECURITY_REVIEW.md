# Security review: 2026-10-31

This is a production-readiness pass over the code on `main` after PR #17. It is an internal review, not a penetration test or a certification.

## What was checked

**Sign-in on every route.** Every route was listed from the controllers. All of them need a signed-in session, and module access and permissions are checked by the global guard, except for these, which are public on purpose:

| Route | Why it is public | Protection |
|---|---|---|
| `POST /auth/login`, `/auth/mfa/verify` | Sign-in | Per-address rate limit (`LOGIN_RATE_LIMIT`), bcrypt, short-lived MFA challenge |
| `/auth/sso/*`, `/auth/saml/*` | Single sign-on | State, nonce, PKCE; signed assertions, one-time use, same-browser finish (see DEPLOYMENT.md) |
| `POST /r/:surveyId/start`, `GET /r/session/:id`, `POST /r/session/:id/answer` | Respondents taking a survey | Only published surveys; the session id is the respondent's credential (see fix 1) |
| `GET /health` | Load balancer checks | Returns no records |
| `GET /metrics` | Prometheus | 404 unless `METRICS_TOKEN` is set and sent (see fix 2) |

The few signed-in routes without a module check (approvals, notifications, own account, live updates, AI status) scope their results in the service. Approvals are filtered per approval, notifications by role, and live events by tenant and role. Live events carry no record data.

**Tenant isolation.** All 33 tenant tables have forced row-level security, and 198 API tests include cross-tenant checks.

**Secrets.** No `.env` file or real key is committed. The only private keys in the repository are the test-only SAML fixtures under `apps/api/src/test/fixtures`. The Integrations page shows settings only as set or unset.

**Test stability.** The full API suite ran three times in a row (198/198 each). The end-to-end browser smoke test ran three times on a fresh seed (36/36 steps each, no page errors). The one red run on `main` (at PR #7) was a real failure fixed in PR #8, not flakiness.

## Fixed in this pass

1. **Guessable survey-session ids.** A respondent's session id was a Prisma `cuid()`, which is mostly a timestamp and a counter. Anyone who guessed an in-progress id could read that session's answers or answer for that person. New sessions now get 144 random bits (`rs_…`). A test checks the format. Existing sessions keep their ids.
2. **Metrics token comparison** is now constant-time.
3. **Dependencies.** The critical `tar` advisory and the high ones in NestJS (`path-to-regexp`), Nodemailer (SMTP command injection, mail to an unintended domain) and `unpdf`/`canvas` are fixed. So are the moderate ones in `mammoth` (directory traversal) and `file-type`. The new versions are NestJS 11.2.7, Nodemailer 10.1.7, unpdf 1.9.0 and mammoth 1.13.0. All tests, including the SMTP and document-import tests, pass on them.

## Open, assessed

| Package | Severity | Why it is not fixed here | Exposure |
|---|---|---|---|
| `multer` (via NestJS) | High | The fix needs NestJS 12 | Multer handles file uploads, and no route accepts multipart uploads (documents come as base64 JSON). Not reachable |
| `prisma`, `@prisma/config`, `effect`, `deepmerge-ts` | High | The fix is Prisma 7, a major migration | Config and CLI tooling, not request handling |
| `zod` | High | The fix is Zod 4, a breaking API change across every validator | Memory use on oversized arrays with constraints. JSON bodies are capped at 12 MB (for base64 questionnaire uploads), which bounds the cost; only some arrays in the schemas set a max length |
| `image-size` (via pptxgenjs) | High | Its fix is a major version under pptxgenjs | Only parses images the app itself puts in PowerPoint reports, never uploads |
| `exceljs` → `archiver`, `glob`, `minimatch`, `uuid` | Moderate | npm's only "fix" is a downgrade to exceljs 3.4 | Used to write spreadsheets, and none of the affected functions get user input |
| `echarts` (web) | Moderate | The fix is ECharts 6 | Chart labels are survey and project names typed by signed-in staff of the same workspace. The CSP allows `'unsafe-inline'` scripts (needed by Next), so it is not a backstop here. Worth doing with the next UI update |
| `next` → `postcss` (web) | High | The fix is Next 16 | Build-time CSS processing of the app's own styles |

Recommended next: plan the Prisma 7 and Zod 4 upgrades together as one dedicated change.

## Outside this repository: the Turn2Opinion panel backend

The panel backend's API description lists routes **without sign-in** that expose respondent data or change state. Examples are `GET survey/responses/{slug}`, `GET integration/respondent-profile/{id}`, `PATCH survey/response`, `project-dev/*`, `POST /email` (sends to any address) and the user app and refresh routes. The full list is in [TURN2OPINION.md](integrations/TURN2OPINION.md#security-observations-on-the-description-for-the-backend-team). MyHealthOpinions holds health-related answers, and the backend handles minors, so this should be checked against the running service before production traffic goes through it. The Sampledge routes in the patch use the panel's own `authenticate` function and return pseudonymous data only. They can't fix the other routes, because that code lives in the backend repository, which was not shared here.

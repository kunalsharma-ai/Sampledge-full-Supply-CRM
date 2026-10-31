# Sampledge AI Research OS

**Phase 4: integrated workflow.** A Next.js web app on a NestJS + Postgres API, sharing one TypeScript domain package. Sign-in, roles, tenant isolation, projects, CRM and quotes, vendors and allocations, survey versions, a public respondent runtime with atomic quotas, panelists and consent, and human approvals all run on the database. Phase 4 connects them: a transactional outbox and worker hand work between modules, supplier feasibility, purchase orders, invoices and vendor payments, a Comms Hub, and client and vendor portals.

Seeded records are fictional demo data and are labelled as such in the UI. No external integrations are connected: messages are recorded by a development adapter and never sent, "paid" is a record (no payment rail), and there are no supplier, panel-site or AI model APIs.

## Run it

Requires Node 22+ and PostgreSQL 16 (or Docker).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # set JWT_SECRET; DATABASE_URL points at your Postgres
npm run db:setup                            # migrate + build + seed demo data
npm run dev                                 # web http://localhost:3000 · API http://localhost:4000/api/v1
```

Sign in with a demo account on `/login` (one per role, password `demo1234`), for example `executive@demo.sampledge.test`.

**Docker:** `docker compose up --build`, then load demo data once with
`docker compose run --rm -e NODE_ENV=development api node dist/seed.js`.

**Without the API** the web app falls back to the Phase 2 offline demo (records in browser storage, labelled "Offline demo").

## Tests

```bash
npm test                         # survey-engine unit tests + API integration tests (creates sampledge_test)
npm run typecheck
node apps/web/e2e-smoke.cjs      # browser end-to-end on a running, freshly seeded stack
```

## What to try
- **Sign in as different roles** from `/login` or the account switcher (top right). The server decides what each role sees: a Sample Vendor gets only its own vendor record; a Client only its own projects, without costs; roles without `view:margins` never receive cost fields.
- **Bidding CRM:** drag a deal to *Won*; the project is created in the same database transaction. *Lost* asks for a reason.
- **Survey Studio** (Survey Programmer): approve a QA fix (each edit is a new immutable version), then *Request publish*. Publishing is blocked while QA finds critical issues, and waits in **AI Automation → Approvals** for someone other than the requester.
- **Respondent link:** once published, open `/r/sv-cloud`. Routing, validation and quota counting run on the server; `?preview=1` (signed in) never counts.
- **Sample Exchange** (Project Manager): *Request PO approval* creates real allocation proposals on a project, each pending a purchase approval.
- **Panels:** the panelist directory reads pseudonymous records, shows consent history, records withdrawals, and routes deletion through an approval. *Connect existing panel websites → Choose CSV* validates and imports members (rows with emails or phone numbers are rejected).
- **Supplier feasibility:** as Business Development, open an opportunity in the CRM and *Request feasibility*. Sign in as the Sample Vendor, answer in the **Vendor Portal**, and the next drafted quote is priced as supplier-confirmed.
- **Purchase → PO → payment:** approve a sample purchase (as someone other than the requester) and a PO, payable and vendor email appear. In **Finance**, *Request payment* waits for an *Issuing payments* approval.
- **Invoice:** move a project with completes to the *Invoice* stage; a draft appears in **Finance**. *Issue* it and the Client sees it in the **Client Portal**.
- **Comms Hub:** send to a panel segment; consent withdrawals are excluded, and more than 100 recipients needs an approval. Every message shows as *Recorded (dev adapter)*.

## Layout
```
packages/core/   shared domain: survey engine, roles and permissions, pricing, analytics, demo seed records
apps/api/        NestJS API: Prisma schema + migrations, auth, guards, modules, seed, integration tests
apps/web/        Next.js app: routes, components, API client and store, e2e smoke test
docs/            architecture, API reference, role matrix, design system, status ledger, roadmap
```

## Docs
- [Implementation status: functional vs simulated vs planned](docs/IMPLEMENTATION_STATUS.md)
- [Architecture & security model](docs/ARCHITECTURE.md)
- [API reference](docs/API_CONTRACTS.md) · [Data model](apps/api/prisma/schema.prisma)
- [Role matrix](docs/ROLE_MATRIX.md) (generated: `npm run docs:roles -w @sampledge/web`)
- [Design system](docs/DESIGN_SYSTEM.md) · live at `/design-system`
- [Wireframes](docs/WIREFRAMES.md) · [screenshots](docs/screenshots)
- [Roadmap](docs/ROADMAP.md)

Globe land outlines: Natural Earth 110m via `world-atlas` (public domain). The logo is a placeholder wordmark; drop the official SVG in `apps/web/src/components/shell/logo.tsx`.

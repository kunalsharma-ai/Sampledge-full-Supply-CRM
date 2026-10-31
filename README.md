# Sampledge AI Research OS

**Phase 1 (architecture + design system) and Phase 2 (interactive dashboard prototype).** All data is fictional demo data and is labelled as such in the UI. No live integrations, no backend yet.

## Run it
```bash
npm install
npm run dev          # http://localhost:3000
npm test             # survey engine unit tests (node --test)
npm run typecheck
npm run build && npm start
```
Requires Node 22+. Or with Docker: `docker build -t sampledge-os . && docker run -p 3000:3000 sampledge-os`.

## What to try
- **Switch role** (top-right) to see navigation, read-only states and redaction change. Try *Sample Vendor* and *Client*.
- **Theme** (moon/sun/monitor) and **reduced motion** (⚡) in the top bar. **⌘K** opens search.
- **Command Center**: click a globe pillar, drag the time scrubber, pick an ops-flow stage, ask the assistant a suggested question.
- **Bidding CRM**: drag a deal to *Won* and watch it appear in Projects. Use the AI bid assistant to extract an RFQ email and model margins.
- **Survey Studio** (role: Survey Programmer): connect nodes in the logic builder, run QA and approve fixes, take the survey in Preview and watch quotas move, ask the assistant to randomise or add quotas, then Undo.
- **Insight Studio**: change crosstab rows/columns, toggle weighting, export CSV, spin the 3D segmentation.
- **AI Automation**: add a node, Test run the workflow, approve items in the queue (permissions apply).
- **Reset demo data** with the ↺ button.

## Docs
- [Architecture & module communication](docs/ARCHITECTURE.md)
- [Data model](prisma/schema.prisma)
- [API contracts](docs/API_CONTRACTS.md)
- [Role matrix](docs/ROLE_MATRIX.md) (generated from code: `npm run docs:roles`)
- [Design system](docs/DESIGN_SYSTEM.md) · live at `/design-system`
- [Dashboard wireframes](docs/WIREFRAMES.md) · [screenshots](docs/screenshots)
- [Implementation status: functional vs simulated vs planned](docs/IMPLEMENTATION_STATUS.md)
- [Roadmap](docs/ROADMAP.md)

## Layout
```
src/app/            routes: command-center, projects, crm, marketplace, panels, survey-studio, analytics, automation, design-system, modules/[slug]
src/components/     ui (primitives, KPI), shell, charts (ECharts), three (globe, scatter, particles), flow (ops flow, workflow editor), survey (logic builder, preview, QA, assistant, import)
src/lib/            tokens, roles, modules, store, demo data, survey engine, pricing, analytics, assistant
prisma/             Phase 3 schema
tests/              engine tests
scripts/            land-dot generator (Natural Earth 110m), role-matrix doc generator
```

Globe land outlines: Natural Earth 110m via `world-atlas` (public domain). The logo is a placeholder wordmark; drop the official SVG in `src/components/shell/logo.tsx`.

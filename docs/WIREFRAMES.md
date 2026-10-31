# Dashboard wireframes

Each dashboard follows the same skeleton: **header → KPI row → hero visual + intelligence panel → operational detail → secondary analytics**. Screenshots of the built screens are in `docs/screenshots/`.

## Command Center
```
┌ Welcome hero (particles, gradient title, persona, Ask AI, New RFQ) ───────────────────────┐
├ KPI × 14 (7 per row on desktop, 4 tablet, 2 mobile) ──────────────────────────────────────┤
├ 3D globe  [metric tabs] [3D|2D]                         │ AI executive assistant           │
│   pillars · arcs · country panel (slide-in)             │   suggestions → answer + sources │
│   [▶ time scrubber: 12 weeks]                           │                                  │
├ Research operations flow: 11 animated stage rings ───────────────────────────────────────┤
│   stage table (project, owner, status, progress, margin, advance) │ stage metrics · blockers │
├ Revenue / cost / forecast           │ Daily completes + incidence                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
## Projects
```
Header [Board|Timeline|List] · KPI × 6 · filters (search, B2B/B2C/HC)
Board: 6 lanes (drag & drop) ............................ │ AI PM: risks · low quotas · cost
Live quota rings × 8                 │ Owner workload stacked bars
Drawer: lifecycle stepper · KPIs · quota rings · budget · suppliers · blockers · activity
```
## Bidding CRM
```
Header [Pipeline|AI bid assistant] [New RFQ] · KPI × 7
Pipeline: 7 stage columns (drag; Won → project)
Funnel │ Forecast │ Win/loss donut
Assistant: Email-to-RFQ + inputs │ CPI bars · 3 price options · sample plan
```
## Sample Exchange
```
KPI × 6 · AI vendor selection (weights │ stacked score bars + explanation + PO request)
Supply heatmap (vendors × markets) │ Vendor radar + rate card
Sankey vendors → projects → markets │ Leaderboard
CPI vs quality bubble chart
```
## Panels
```
Brand cards × 3 (select) · KPI × 6
Recruitment funnel │ Age/gender pyramid │ Quality distribution
Engagement trend (2 cols) │ Cohort retention heatmap
Reward policy editor │ Panel automations │ Healthcare safeguards
Integration steps
```
## Survey Studio
```
Tabs: Dashboard · Logic builder · Preview & test · Automated QA · AI assistant · Import
Dashboard: KPI × 6 · survey table │ workload + complexity scatter · question library
Logic builder: React Flow canvas (blocks as columns, end nodes, quota nodes, minimap) │ Inspector
Preview: device frame │ execution trace · quotas · responses
QA: controls · summary × 5 · reach bars · issue table with Approve fix
```
## Insight Studio
```
Dataset badge · weighting toggle · presentation view · KPI × 5
Crosstab explorer (metric/rows/cols, heat cells, sig letters, CSV) │ 3D/2D segmentation
Brand journey sankey (2 cols) │ NPS distribution
Wave trend (2 cols) │ Editable narrative
```
## AI Automation
```
KPI × 8 · Workflow editor (toolbar, canvas, inspector, run log) │ Approval queue
Agents grid × 12 (toggle, runs, success, saved, spend vs cap, approval scopes)
Executions/day │ Execution log │ AI safety policy
```

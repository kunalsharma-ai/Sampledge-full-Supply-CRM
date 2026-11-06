# Audience Orbit X — SUPPLY360 design specification

Audience Orbit X is the design system and interaction model for SUPPLY360, Sampledge's respondent supply management platform. It replaces the generic "Research OS" look with an identity built around one idea: **an audience is an orbit**. Respondents move inward from registered, to verified, to profiled, to active, to reachable today. Every screen helps an operator move the right people inward, faster, and spend them wisely.

Live reference: `/supply/theme-studio` (themes, comfort settings, contrast report) and `/supply/executive` (the flagship screen). Code: `apps/web`.

---

## 1. Design identity

| Principle | What it means on screen |
|---|---|
| **Premium at first glance, comfortable all day** | Cosmic Intelligence is the default. Five more themes, including three light ones, exist for long sessions. Density and text size are user controls, not design accidents. |
| **One signature visual per screen** | Each screen leads with the visual that carries its meaning (Supply Orbit, routing graph, quota matrix, ledger). Everything around it is calm, dense and readable. |
| **3D only where depth explains something** | The globe (screen 2) shows geography and live traffic. Nothing else is 3D, and every 3D view has a fast 2D alternative. |
| **Motion is feedback, not decoration** | Things move when data changes or the user acts. Nothing loops in operational screens. |
| **Colour has a job** | Primary = action and focus. Violet = AI. Cyan = live signal. Emerald = healthy. Orange = demo data and warnings. Red = risk. Product colours belong to SAMPLEON (teal), PROJEXA (amber) and ZAPX (pink); panel colours to T2O (blue), MFR (violet) and MHO (green). |
| **Honesty is visible** | Synthetic data carries a dashed orange **Demo data** badge. Estimates say "estimate". Screens not yet built show their design brief rather than fake functionality. |
| **Never colour alone** | Every status has a glyph and a label as well as a colour (WCAG 1.4.1). |

What we avoid: heavy glow, stacked glass, oversized cards, decorative loops, nested menus, modal-on-modal.

## 2. Themes

Six themes, chosen in the topbar theme menu, the command palette (`⌘K → Theme`) or Theme Studio. "Follow system" maps OS dark → Cosmic and OS light → Bright Enterprise. The choice persists per device and is applied before first paint (inline boot script in `layout.tsx`), so there is no flash.

| Theme | Mode | Character | Best for |
|---|---|---|---|
| **Cosmic Intelligence** (default) | Dark | Deep space `#070B1C`, orbit blue, AI violet, ambient light | Command views, executive reviews |
| Midnight Blue | Dark | Same layout, no blur, ambient light at 5% | Long sessions in a dark room |
| Bright Enterprise | Light | White surfaces, confident blue | Daytime work, dense tables, screen sharing |
| Emerald | Light | Calm green-led, teal accent | Rewards, finance, approvals |
| Warm Neutral | Light | Paper tones, terracotta | Reading-heavy work: support, content |
| High Contrast | Dark | Pure black, white text, 50% borders, yellow focus, no blur or glow | Low vision, glare, accessibility review |

Legacy preferences `dark` / `light` migrate to Cosmic / Bright Enterprise (store version 4).

## 3. Design tokens

Source of truth: CSS variables in `apps/web/src/app/globals.css`, stored as RGB channels so Tailwind alpha works (`bg-primary/15`). Each theme is a `[data-theme='…']` block, so a token set can also be scoped to any element (Theme Studio's previews do this). Registry and runtime reader: `apps/web/src/lib/themes.ts` (`readTokens()` feeds ECharts and three.js).

**Colour roles**

| Token | Role |
|---|---|
| `--bg`, `--bg-2` | Page and secondary page background |
| `--surface`, `--surface-2` | Cards, popovers; nested surfaces |
| `--line` + `--line-alpha` | Hairlines (`.hairline`) |
| `--ink`, `--ink-2`, `--ink-3` | Text: primary, secondary, muted (all ≥ 4.5:1 on `--bg` in every theme) |
| `--primary`, `--primary-2` | Brand action colour and its gradient partner (used as text and accents) |
| `--primary-strong` | Button fills; meets 4.5:1 with `--on-primary` |
| `--on-primary` | Text on primary fills |
| `--focus` | Focus ring (≥ 3:1 against `--bg`) |
| `--blue … --magenta`, `--danger`, `--warn` | Hue tokens; keep their hue in every theme |
| `--chart-1 … --chart-6` | Ordered categorical chart series |
| `--glass`, `--glass-alpha`, `--blur`, `--ambient` | Surface translucency and ambient light per theme |
| `--shadow-panel`, `--shadow-lift` | Elevation 1 and 2 |

**Typography** — Manrope (display, headings), Inter (UI and body), Plus Jakarta Sans (metrics, tabular numerals).

| Style | Size / weight | Use |
|---|---|---|
| Display | 28px / 700, −0.02em | Screen title |
| H2 | 15px / 600 | Section title |
| Body | 13–14px / 400 | Text, table cells |
| Small | 12px / 500 | Labels, metadata |
| Eyebrow | 11px / 600, +0.14em, uppercase | Section kicker |
| Metric | 22–30px / 700, tabular | KPI values |

**Spacing** 4-point scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Panels pad 16–20px; grids gap 12–16px. **Radius** 8 (controls), 12 (inputs, buttons), 16–20 (panels), pill. **Density** `--row-h` 30 / 36 / 44px and `--nav-h` 28 / 32 / 36px for compact / default / comfortable. **Text size** root 15 / 16 / 17.5px.

## 4. Component library

| Layer | Components | File |
|---|---|---|
| Primitives | Panel, Button (cva variants: primary, outline, ghost, subtle, danger, success; sizes xs–md, icon), Badge, DemoBadge, Segmented, SearchInput, Field, EmptyState, ErrorState, Skeleton, ProgressRing, Bar, Drawer, PageHeader | `components/ui/primitives.tsx` |
| Overlays (shadcn/ui pattern on Radix) | Dialog, Sheet, ConfirmDialog (type-to-confirm), Popover, Tooltip, Tabs, Switch, DropdownMenu, Kbd | `components/ui/overlay.tsx` |
| Forms | MultiSelect (searchable, keyboard), country and language option sets, ValidatedInput (inline validation after blur), AutosaveStatus + `useAutosave` | `components/ui/forms.tsx` |
| Data | DataTable (sort, selection, bulk-action bar, persisted columns, density, keyboard), StatusPill / StatusDot / `paceStatus` | `components/ui/table.tsx`, `components/ui/status.tsx` |
| Charts | EChart wrapper (lazy, theme-aware, reduced-motion aware), Sparkline, AnimatedNumber | `components/charts/echart.tsx`, `components/ui/kpi.tsx` |
| SUPPLY360 kit | SupplyHeader, KpiTile, ProductChip, PanelChip, CountryChips, SectionTitle, SupplyOrbit | `components/supply/` |
| Navigation | SupplyNav (groups, jump filter, collapsed rail with flyouts), mobile sheet, mobile tab bar, command palette, shortcuts dialog | `components/shell/` |

**Patterns**
- *Notifications*: transient toasts (bottom centre, `aria-live=polite`, 3.8s) for results; the Notification Center for anything that needs action.
- *Modals*: one level only. Drawers for "peek and act" on a row; Dialogs for focused tasks; ConfirmDialog for anything destructive.
- *Destructive actions*: confirmation always; type-to-confirm for bulk or irreversible ones; undo window (6s) where the action can be reversed.
- *Empty states*: say what will appear and how to make it appear, with one action.
- *Loading*: skeletons shaped like the content, never spinners for page content.

## 5. Navigation architecture

Nine groups, 42 screens (one hidden: the 360° profile opens from the explorer). Registry: `apps/web/src/lib/supply/screens.ts`; the sidebar, command palette, shortcuts, mobile navigation and role guard all read it.

```
Command              Executive Dashboard · Global Panel Intelligence · AI Copilot · Analytics & Reporting · Notification Center
Panels               Turn2Opinion · MyFrequentRewards · MyHealthOpinions
Respondents          Database Explorer (→ 360° Profile) · Registration & Verification · Profile Completion Automation
                     Demographic / B2B / Healthcare Profiling Studios · Quality & Risk · Activity Timeline
Audiences            AI Segmentation · Feasibility Studio · Global Distribution
Surveys & fieldwork  Survey Inventory · AI Survey Generation · Weekly Rewards Surveys · Routing · Soft & Full Launch · Batches · Quotas
Connected products   SAMPLEON Allocation · PROJEXA Requests · ZAPX Requests
Engagement           Automation Builder · Email Campaigns · Newsletter Studio · Lifecycle Journeys
Rewards & support    Rewards & Wallet · Redemption Approvals · Support Tickets · AI Support Assistant
Platform             API Hub · Roles & Permissions · System Settings · Theme Studio
Research OS          (existing modules: Command Center, Projects, CRM, Survey Studio, Panels, …)
```

Wayfinding: breadcrumb in the topbar; groups expand automatically for the current screen and remember their state; `/` filters the nav; `⌘K` searches screens, records and actions; `g` + key jumps (d dashboard, p panellists, a audiences, f feasibility, r routing, l launch, q quotas, s SAMPLEON, w rewards, t tickets). Role access reuses the core role matrix (`screens[].module` → `access()`), the same rules the API enforces.

The supply executive's eight core jobs map to at most two clicks from anywhere: find respondents (`g p`), build an audience (`g a`), calculate feasibility (`g f`), allocate to PROJEXA/ZAPX (`g s`), launch batches (`g l`), monitor quotas (`g q`), handle rewards (`g w`), resolve support cases (`g t`).

## 6. Screens

Every screen has its own layout idea. Wave = the delivery PR it lands in.

| # | Screen | Route | Group | Wave | Layout idea |
|---|---|---|---|---|---|
| 1 | **Executive Dashboard** | `/supply/executive` | Command | 1 | Supply Orbit hero (concentric funnel rings) beside six live KPIs, a fieldwork flight deck of audience requests, an inline decision queue, panel brand cards and hourly completes. |
| 2 | **Global Panel Intelligence** | `/supply/global-intelligence` | Command | 6 | Optional interactive 3D globe with arcs for live survey traffic and a fast 2D choropleth alternative; country drawer with panel mix, reachability and quotas. |
| 3 | **Turn2Opinion** | `/supply/turn2opinion` | Panels | 2 | Brand-tinted panel cockpit: membership funnel, recruitment sources, survey card performance and a brand settings strip. |
| 4 | **MyFrequentRewards** | `/supply/myfrequentrewards` | Panels | 2 | Loyalty-tier view: tier pyramid, points economy (earned vs redeemed), streaks and weekly rewards survey uptake. |
| 5 | **MyHealthOpinions** | `/supply/myhealthopinions` | Panels | 2 | Specialty matrix (specialty × country), credential verification queue and compliance (honoraria caps, consent) indicators. |
| 6 | **Panellist Database Explorer** | `/supply/panellists` | Respondents | 2 | Dense, virtualised data grid with saved views, customisable columns, facet rail, bulk actions with confirmation and a peek drawer. |
| 7 | **Panellist 360° Profile** | `/supply/panellists/profile` | Respondents | 2 | Compact identity panel, interactive profile sections, engagement history, rewards timeline and an operational action rail. |
| 8 | **Registration & Verification** | `/supply/registration` | Respondents | 2 | Funnel strip on top, verification review queue with side-by-side evidence, and rule outcomes (email, device, IP, document). |
| 9 | **Profile Completion Automation** | `/supply/profile-automation` | Respondents | 2 | Gap heatmap (attribute × panel) with one-click nudge campaigns, progressive-profiling rules and lift tracking. |
| 10 | **Demographic Profiling Studio** | `/supply/profiling/demographic` | Respondents | 2 | Question library tree, live respondent preview, coverage by country and attribute versioning. |
| 11 | **B2B Profiling Studio** | `/supply/profiling/b2b` | Respondents | 2 | Taxonomy mapper (raw titles to normalised roles), seniority × industry coverage grid and verification signals. |
| 12 | **Healthcare Profiling Studio** | `/supply/profiling/healthcare` | Respondents | 2 | Specialty ontology browser, condition prevalence vs panel coverage, credential-check status per country. |
| 13 | **AI Audience Segmentation** | `/supply/segmentation` | Audiences | 2 | Split-screen audience builder: nested AND/OR filter tree with live counts on the left, demographic charts on the right, AI natural-language input on top. |
| 14 | **Audience Feasibility Studio** | `/supply/feasibility` | Audiences | 2 | Scenario columns side by side (IR, LOI, completes, fatigue), country waterfall from eligible to achievable, and a confidence band. |
| 15 | **Global Audience Distribution** | `/supply/distribution` | Audiences | 6 | 2D map with proportional symbols, panel stacks per country and a time-zone wake band for send planning. |
| 16 | **Survey Inventory** | `/supply/surveys` | Surveys & fieldwork | 3 | Kanban-by-status with a table toggle, source chips (PROJEXA, ZAPX, partner), CPI, IR, LOI and quota health. |
| 17 | **AI Survey Generation** | `/supply/survey-generation` | Surveys & fieldwork | 4 | Brief on the left, generated questionnaire in the centre with per-question rationale, quality checks on the right. |
| 18 | **Weekly Rewards Surveys** | `/supply/weekly-rewards` | Surveys & fieldwork | 4 | Week calendar strip, programme health (uptake, cost per complete), and a template carousel. |
| 19 | **SAMPLEON Audience Allocation** | `/supply/sampleon` | Connected products | 6 | Request pipeline from PROJEXA and ZAPX: feasibility, allocation, quotas, batches and fieldwork progress in one workspace. |
| 20 | **PROJEXA Audience Requests** | `/supply/projexa-requests` | Connected products | 6 | Request inbox with project context (client, milestones, budget) and accept / counter-propose actions. |
| 21 | **ZAPX Audience Requests** | `/supply/zapx-requests` | Connected products | 6 | Survey-first request cards (survey preview, redirects, QA status) with feasibility and launch approval. |
| 22 | **Survey Routing Intelligence** | `/supply/routing` | Surveys & fieldwork | 3 | Interactive routing graph: entry → eligibility decisions → surveys (quota state) → validated outcomes, with path replay. |
| 23 | **Soft Launch & Full Launch** | `/supply/launch` | Surveys & fieldwork | 3 | Launch checklist rail, soft-launch read-out (IR, LOI, drop-off vs plan) and a gated full-launch control with confirmation. |
| 24 | **Batch Scheduling** | `/supply/batches` | Surveys & fieldwork | 3 | Timeline (Gantt) of batches per country with drag to reschedule, send-window guards and throttle previews. |
| 25 | **Quota Monitoring** | `/supply/quotas` | Surveys & fieldwork | 3 | Quota matrix (cells coloured by pace), burn-down per cell and auto-actions (close, boost, re-batch). |
| 26 | **Engagement Automation Builder** | `/supply/automation` | Engagement | 4 | Node-based workflow editor with triggers, conditions, delays and actions, test-run preview and execution logs. |
| 27 | **Email Campaign Designer** | `/supply/email` | Engagement | 4 | Block editor with live desktop/mobile preview, audience and consent check, send-time optimiser and A/B setup. |
| 28 | **Newsletter Studio** | `/supply/newsletters` | Engagement | 4 | Issue board (draft → review → scheduled → sent), content library and per-panel brand templates. |
| 29 | **Respondent Lifecycle Journeys** | `/supply/journeys` | Engagement | 4 | Swimlane journey map by lifecycle stage with conversion between stages and the automations attached to each. |
| 30 | **Notification Center** | `/supply/notifications` | Command | 4 | Inbox-zero list with priority lanes (Act, Review, FYI), inline actions, snooze and per-channel delivery rules. |
| 31 | **Rewards & Wallet Management** | `/supply/rewards` | Rewards & support | 5 | Financial operations view: liability by panel, immutable ledger with transaction statuses and reconciliation against payouts. |
| 32 | **Redemption Approval Center** | `/supply/redemptions` | Rewards & support | 5 | Approval queue with risk score, respondent context and batched approve with confirmation and undo window. |
| 33 | **Support Ticket Management** | `/supply/support` | Rewards & support | 5 | Three-pane workspace: ticket list, conversation, respondent context; macros and SLA timers. |
| 34 | **AI Support Assistant** | `/supply/support-ai` | Rewards & support | 5 | Suggestion review lane (accept / edit / reject), knowledge sources used per answer and deflection metrics. |
| 35 | **Quality & Risk Intelligence** | `/supply/quality-risk` | Respondents | 5 | Risk radar by signal, case queue with evidence timeline, rule tuning with backtest and reversible actions. |
| 36 | **Panellist Activity Timeline** | `/supply/activity` | Respondents | 5 | Streaming event log with lanes by type, scrubber, filters and jump-to-profile. |
| 37 | **AI Copilot Command Center** | `/supply/copilot` | Command | 6 | Conversation canvas with structured answer cards (counts, charts, filters), a proposed-actions tray that needs explicit approval and a running context rail. |
| 38 | **Analytics & Reporting** | `/supply/analytics` | Command | 6 | Report builder: metric shelf on the left, pivot canvas in the centre, schedule and export panel on the right; saved reports gallery. |
| 39 | **API Integration Hub** | `/supply/api-hub` | Platform | 6 | Connection map (SUPPLY360 ↔ SAMPLEON, PROJEXA, ZAPX, panels), event delivery log with retry and API key management. |
| 40 | **User Roles & Permissions** | `/supply/roles` | Platform | 6 | Role × capability matrix with diff preview before saving, and per-user overrides with expiry. |
| 41 | **System Settings** | `/supply/settings` | Platform | 6 | Searchable settings index with sections, change history and safe-mode preview for risky settings. |
| 42 | **Theme Customization Studio** | `/supply/theme-studio` | Platform | 1 | Live theme gallery with a real component preview, contrast checks, density and motion controls; saved to your profile. |

### Flagship: Executive Dashboard (built in wave 1)

Read top to bottom as four questions:
1. **Is supply healthy?** Supply Orbit (five funnel rings, hover for stage conversion) beside six KPIs with deltas coloured by whether "up" is good.
2. **What is in the field and what needs me?** Fieldwork flight deck (audience requests from PROJEXA and ZAPX with quota-cell health; row opens a drawer with quotas, supply mix, pause/resume with confirmation) and a decision queue (approve / hold inline, 6s undo, type-to-confirm for suspensions).
3. **Where is it coming from?** Panel brand cards, completes by hour, top markets.
4. **What could go wrong?** Quality signals, support SLA, activity feed.

Panel and range filters re-scale every figure with a 0.6s value transition.

## 7. Responsive layouts

| Breakpoint | Layout |
|---|---|
| Desktop ≥ 1280px | 264px sidebar (or 64px rail), 12-column content grid, max width 1600px |
| Laptop 1024–1279px | Sidebar stays; hero sections stack to 1 + 1 columns |
| Tablet 640–1023px | Sidebar becomes a sheet (hamburger); bottom tab bar with Home, Panellists, Audiences, Quotas, Rewards; two-column KPI grids |
| Phone < 640px | Single column; tables scroll horizontally with sticky headers; drawers become full-width sheets; search collapses to "Search…" |

## 8. Animation specification

| Token | Duration | Easing | Used for |
|---|---|---|---|
| `fast` | 120–180ms | ease-out / `cubic-bezier(.2,.8,.2,1)` | Hover, focus, popovers, dialogs, status pops, nav group expand |
| `base` | 200–280ms | `cubic-bezier(.2,.8,.2,1)` | Page transitions (fade + 6px rise), drawers, bulk-action bar, list insert/remove |
| `value` | 600ms | same | KPI number transitions when filters change |
| `draw` | 900–1000ms | same | First draw of charts and Supply Orbit rings (once) |
| `ambient` | none | — | No looping motion in operational screens |

Specific behaviours: KPI values count to the new value; chart series morph on filter change; filter results fade in; status pills pop (scale .92 → 1); notifications slide up from the bottom; decisions collapse out with height animation; nav active marker slides between items (spring, low bounce); country selection on the globe eases the camera (wave 6); workflow execution highlights nodes in sequence (wave 4).

**Reduced motion**: the in-app switch (`data-motion="reduced"`) and the OS `prefers-reduced-motion` both cut CSS animation and transition durations to ~0, disable ECharts animation, skip count-ups and ring draws, and stop 3D auto-rotation.

## 9. Accessibility

- WCAG 2.2 AA target; High Contrast theme targets AAA for text. Theme Studio measures live contrast for the current theme.
- Visible focus ring in `--focus` on every interactive element; skip-to-content link.
- Radix primitives provide focus trapping, Escape, `aria-modal`, labelled dialogs and returning focus.
- Tables: `caption`, `scope=col`, `aria-sort`, keyboard row navigation (↑↓/jk, Enter, x, Esc).
- Statuses use glyph + label + colour; charts carry `role="img"` with a text description.
- Collapsed nav groups are `inert`, so hidden links are not tabbable.
- Touch targets ≥ 36px on mobile tab bar and nav.

## 10. Performance

- ECharts and three.js load lazily per chart / scene; the globe pauses when off-screen.
- No continuous animations; `backdrop-filter` is one level deep and disabled in Midnight and High Contrast.
- Theme switch is a single attribute change on `<html>`; no re-render of the tree.
- Data tables render only visible columns; virtualisation arrives with the Panellist Explorer (wave 2) for 100k+ rows.

## 11. Data and backend integration

Screens use `useSupplyData(key, demo, live)` (`lib/supply/data.ts`): live when the API is connected and the endpoint answers, otherwise the synthetic set in `lib/supply/demo.ts`, always labelled. Endpoints available today: `/panels/summary`, `/panels/panelists`, `/panels/panelists/:id`, `/panels/analytics`, `/panels/reward-policy`, `/approvals/:id/decision`. SAMPLEON, PROJEXA and ZAPX screens (wave 6) bind to the audience-request API contract defined by the SAMPLEON integration work.

## 12. Delivery waves

1. **Foundation** — this spec, tokens, six themes, component library, navigation, Executive Dashboard, Theme Studio.
2. **Respondents & audiences** (built) — panels, explorer, 360° profile, registration, profiling studios, segmentation, feasibility.
3. **Fieldwork** (built) — survey inventory, routing graph, launches, batches, quotas.
   - Pace = achieved share of target ÷ share of field time passed. Bands: ahead ≥ 1.15, on pace ≥ 0.92, behind ≥ 0.7, otherwise at risk.
   - Batch times are UTC; quiet hours are 21:00–08:00 local, and moves into them are refused.
   - Full launch is gated: soft-launch data, a complete checklist, and a written reason for any metric off plan.
   - Planned SAMPLEON endpoints: `GET /sampleon/v1/surveys`, `POST /sampleon/v1/surveys/:id/launch`, `PATCH /sampleon/v1/batches/:id`, `GET /sampleon/v1/routing/flows`. Quota actions use the existing `POST /panel-backend/:panel/projects/:id/actions`.
4. **Engagement** (built) — automation node editor, email, newsletters, journeys, notifications, AI survey generation, weekly rewards.
   - Anything that messages members (activating a workflow, sending an email, scheduling a newsletter) asks for confirmation first. Test runs send nothing.
   - The AI drafter is local and deterministic in demo mode. Live mode will call `POST /ai/survey-draft` (planned) through the AI gateway, and drafts open unpublished in Survey Studio.
   - Notification delivery rules persist per user (`prefs['notify:rules']`).
5. **Rewards, support & quality** (built) — ledger, redemptions, three-pane support, AI support, quality & risk, activity timeline.
   - The points ledger is append-only. Each row carries its hash and the previous row's hash, and corrections are new rows. 100 points = $1.
   - Redemption decisions and quality actions are reversible: redemptions have a 10-second undo window, and a suspension can be lifted from the case.
   - AI support drafts always show their sources. Auto-send needs confirmation and never covers drafts that propose an action.
6. **Global, connected products & platform** — shipped in two parts.
   - **6a (built):** global intelligence (3D globe with a 2D map and a ranked list carrying the same numbers), distribution, SAMPLEON allocation, PROJEXA requests, ZAPX requests.
     - The globe starts in 2D when WebGL is missing or motion is reduced.
     - Map symbols are sized by area, and each one is a keyboard button.
     - Send windows are 08:00–21:00 local, the same rule batch scheduling uses.
     - SAMPLEON screens use the contract from the integration work: request statuses `submitted → feasibility_ready → approved → soft_launch → live → closed` (plus `paused`); feasibility fields `eligible`, `reachable`, `estimatedCompletes`, `shortfall` and `byCountry`; and the event names (`audience.approved`, `batch.scheduled`, `invitation.delivered`, `survey.completed`, `quota.full`, `quality.failed`).
     - Allocation is points of 100 per panel, checked inline. Health criteria warn when the split goes outside MyHealthOpinions.
     - Approving an allocation or a ZAPX launch asks for confirmation. Accepting a PROJEXA request has an 8-second undo. Counter-proposals need a reason and show a diff.
     - ZAPX launch stays locked until every QA check passes, and the lock names the failing check.
   - **6b (built):** AI copilot, analytics and reporting, API hub, roles and permissions, system settings.
     - The copilot answers with cards that link to the screen where each number can be checked. It only proposes actions; medium- and high-risk ones need confirmation. Demo answers come from a local router over the seeded data; live mode will use `POST /ai/copilot`.
     - Saved reports persist in user preferences (`prefs['reports:saved']`). CSV export downloads the pivot on screen, aggregates only.
     - New API keys show their secret once. Revoking needs the key name typed. Retrying deliveries is safe because receivers de-duplicate by event id.
     - Role changes are a draft with a reviewed diff. Platform admin keeps settings and API access. Panellist identity is never available. Overrides need a reason, must grant more than the role, and expire within 30 days.
     - Risky settings preview their impact before saving. Turning off "health attributes leave only as match / no match" is blocked.
7. **Live wiring (built)**: screens read API endpoints that already exist, and fall back to the labelled demo set offline.
   - **Notification Center**: the caller's unread notifications from `GET /notifications`, sorted into the Act, Review and FYI lanes by their wording. Done calls `POST /notifications/:id/read`, which can't be undone, so the Undo button only appears offline.
   - **SampAudience allocation**: the "Recorded in SUPPLY360" strip shows the real survey card, participation and reward totals from `GET /panels/sampleon/overview`. The pipeline is still demo data and is labelled as such.
   - **API hub**: "Configured on the API server" lists `GET /integrations`. Secrets are reported only as set or missing. The connection map, delivery log and keys are still demo data.
   - **Roles**: "People in this workspace" lists `GET /admin/users` (admins only) and changes a sign-in role with `PATCH /admin/users/:id/role` after a confirmation.
     - Your own role, and vendor and client accounts, can't be edited.
     - Granting Platform Admin opens a "Granting admin access" approval instead of applying.
   - Headers say "Partly demo data" when a screen mixes both. In `lib/supply/data.ts`, the `endpoints` entries for these paths are now `available`.
8. **New endpoints (built)**: the API gains three endpoints, each over existing data except settings, which adds one column.
   - **Delivery log**: `GET /integrations/deliveries` (with `/summary`) lists the outbox the worker drains.
     - Statuses are delivered, queued, retrying and failed (5 attempts). Payloads are never returned.
     - `POST /integrations/deliveries/:id/retry` puts a failed event back in the queue and is audited. It needs integrations write access (platform admin).
     - The API hub shows the live log, with a confirmation before "Retry all failed".
   - **Points ledger**: `GET /panels/ledger` lists incentive entries with each member's handle and brand. Panel roles can read it; entries are still posted in Finance.
     - Rewards & wallet shows the live ledger. The hash chain and "Verify chain" stay demo-only until the ledger stores hashes.
   - **Workspace settings**: `GET` and `PATCH /admin/settings`.
     - Rules live in `@sampledge/core` (`settingRules`, `settingError`), so the screen and the API check the same things.
     - Values are stored in `Tenant.supplySettings` (migration `20261106150000_supply_settings`), and every change is an audit entry.
     - A PATCH applies all changes or none.
     - Settings owned elsewhere are read through and refused here: point value (Finance), weekly invitation cap and minimum redemption (panel reward policy).
     - Turning off "health attributes only as match / no match" is refused by the server too.
     - Roles without admin write access see the settings read-only.
9. **In-place help (built)**: every screen title and every section title has an "i" button that says what the thing is for, how to use it and where it fits, with links to the screens people usually open next.
   - All the text lives in `apps/web/src/lib/supply/help.ts`. Screens are keyed by slug, and sections by their title or the small label above it. Edit the words there; no code change is needed.
   - `SupplyHeader` and `SectionTitle` look the help up from the current path. Custom headers pass `sectionHelp(slug, key)` to `InfoTip`.
   - `/supply/guide` lists every screen with the same text and has a search. It is linked from the sidebar and from every help panel.
   - The button is a real 24px button that opens a popover. It works with Enter and Escape, and focus returns to the button when the popover closes.
10. **Working records, analytics facts, weekly programme and quota closing (built)**.
   - **Working records**: `SupplyRecord` (migration `20261107090000_supply_records`) holds SUPPLY360 things with no dedicated table. Kinds are registered in `apps/api/src/modules/supply-kinds.ts` and served by `/supply/records/:kind` (`modules/supply-records.ts`).
     - Each kind names the module whose role access applies. Reading needs any access, changing needs full access, and vendors and clients never see supply records.
     - Each kind has a zod shape, statuses and allowed actions (status changes). An action can carry an effect that commits in the same transaction.
     - Updates and actions send the version the person last saw; a stale version gets 409 instead of overwriting. Every create, update and action is an audit entry (entity `SupplyRecord`).
     - Web: `records.list/get/create/update/act` in `lib/supply/live.ts`.
   - **Analytics**: the report builder pivots `GET /supply/facts` (last 8 ISO weeks, one row per panel × country × week × source), counted from SampAudience sessions, survey cards, sign-ups and posted earn entries. Saved reports are `report` records, shared by the workspace; deleting one archives it.
   - **Weekly rewards**: weeks are `weekly` records (one per ISO week: planned → scheduled → sent, or cancelled). `GET /supply/weekly-programme` adds invitations, completes and reward cost for weeks SampAudience ran, linked by audience request id. "Plan next week" adds the next free week.
   - **Quota monitoring**: live projects in soft launch, full launch or fieldwork with their quota cells. "Close cell" asks for a reason and calls `POST /supply/quotas/:id/close`; the runtime then sends anyone who matches the cell to the over-quota end until `/reopen`. Incentive boosts and extra batches are SampAudience rules, and the screen says so when live.
11. **SampAudience requests read through (built)**: the allocation, SampTrek requests, SampCode requests, survey inventory, launch, batches and routing screens show SampAudience's real audience requests when it is connected.
   - The API reads them with SUPPLY360's signed service identity (`integrations/sampleon/requests-proxy.ts`):
     - `GET /sampaudience/status` says whether it is connected and where its console is.
     - `GET /sampaudience/requests` (optional `platform`, `status`) returns each request's full view: feasibility, allocation, quota cells, batches, outcomes and routing counts. It adds what SUPPLY360 recorded for it: survey cards, completes and reward points.
     - `GET /sampaudience/requests/:id` returns one request in the same shape.
   - Panel and marketplace roles can read these. Other roles get 403. A SampAudience error is a 502 with its message.
   - Decisions stay in SampAudience, because approving, launching, batching and pausing need a SampAudience approver. Live screens therefore show a "Decide in SampAudience" link to the console (`SAMPLEON_CONSOLE_URL`, or `${SAMPLEON_URL}/console`) in place of the demo buttons. In `lib/supply/data.ts` those endpoints are marked `console`.
   - When `SAMPLEON_URL` and `SAMPLEON_SECRET` are not set, the screens keep their labelled demo data. Routing is "Partly demo data": the graph is a model, and the table under it holds the real counts.
   - Web mappers are in `lib/supply/sampaudience.ts`. Budget and CPI stay in SampTrek, so live screens show "—" or "In SampTrek" for them.

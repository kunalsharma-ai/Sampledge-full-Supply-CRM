# Design system

Live reference: `/design-system` in the running app.

## Principles
1. **Command center, not admin template.** Every dashboard leads with one spatial or animated "hero" visual that carries meaning (globe, ops flow, logic graph, sankey), surrounded by dense, calm, readable panels.
2. **Motion is earned.** Continuous motion only where it encodes something live (supply arcs, flow dashes, particles in the welcome hero). Tables, kanban and forms never animate continuously.
3. **One accent per meaning.** Cyan = live data/highlight · Blue = primary action · Purple = AI · Emerald = healthy/success · Orange = warning and *demo data* · Magenta = selection/today · Red = risk.
4. **Glass is one level deep.** `.panel` uses blur once; nested surfaces use `.panel-solid`.
5. **Honesty is a visual element.** Simulated surfaces carry the dashed orange `DemoBadge`. Estimates are badged as estimates.

## Tokens
Defined as RGB channels in `apps/web/src/app/globals.css` (`--bg`, `--surface`, `--ink`, `--blue` …) so Tailwind alpha works (`bg-blue/15`). JS mirror in `apps/web/src/lib/tokens.ts` for ECharts and three.js.

| Token | Dark | Light |
|---|---|---|
| `--bg` | #080D1F Midnight Navy | #F4F6FC |
| `--bg-2` | #101936 Deep Space Blue | #E9EDF8 |
| `--blue` | #246BFD | #1C5CE6 |
| `--purple` | #713BFF | #6230E6 |
| `--cyan` | #18D7F2 | #0896B4 |
| `--emerald` | #13C996 | #0A9670 |
| `--orange` | #FF914D | #DC6E28 |
| `--magenta` | #DA4EFF | #AA32D2 |

Typography: Manrope (display, headings), Inter (UI, body, tables, tabular numerals), Plus Jakarta Sans (metric numerals). Scale in `tokens.ts → typeScale`.
Spacing: 4-pt scale. Radii: 8/12/16/20/pill. Motion: fast 150 ms, base 280 ms, slow 600 ms, cinematic 1.4 s, ease `cubic-bezier(.2,.8,.2,1)`.

## Components (`src/components`)
| Component | File | Notes |
|---|---|---|
| Panel, PanelHeader, PageHeader | `ui/primitives.tsx` | layered glass surface |
| Button (primary/outline/subtle/ghost/danger), Badge, DemoBadge | `ui/primitives.tsx` | |
| Segmented, SearchInput, Field, inputCls | `ui/primitives.tsx` | keyboard + ARIA radiogroup |
| EmptyState, ErrorState, Skeleton | `ui/primitives.tsx` | required on every data surface |
| ProgressRing, Bar, Stat, Drawer | `ui/primitives.tsx` | Drawer closes on Esc |
| KpiCard, AnimatedNumber, Sparkline | `ui/kpi.tsx` | tilt + light, refresh, redaction, drill-down |
| EChart, chartBase, axis | `charts/echart.tsx` | lazy, theme-aware, loading/error |
| GlobeExplorer / GlobeScene | `three/` | R3F, time scrubber, 2D fallback |
| Scatter3D, ParticleField | `three/` | |
| OpsFlow | `flow/ops-flow.tsx` | |
| LogicBuilder, OpsFlow | `survey/`, `flow/` | React Flow |
| Shell, CommandPalette, Assistant | `shell/` | |

## Accessibility
Skip link, visible focus ring (cyan), ARIA roles on segmented controls, switches and dialogs, `aria-live` toasts, keyboard command palette, charts carry `aria-label`, 3D views have 2D equivalents, reduced motion honoured. Contrast: body ink on surfaces ≥ 7:1 dark, ≥ 9:1 light; secondary ink ≥ 4.5:1.

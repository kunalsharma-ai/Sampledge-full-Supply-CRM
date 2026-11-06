import type { ModuleId } from '../core';

/**
 * SUPPLY360 navigation architecture (Audience Orbit X). Every one of the 42 screens is registered
 * here once: the sidebar, command palette, mobile sheet, shortcut map and role guard all read it.
 *
 * `module` maps a screen onto the role matrix in @sampledge/core, so role access stays enforced by
 * the same rules the API uses. `wave` is the delivery PR the screen lands in (1 = foundation).
 */
export type NavGroup = 'Command' | 'Panels' | 'Respondents' | 'Audiences' | 'Surveys & fieldwork' | 'Connected products' | 'Engagement' | 'Rewards & support' | 'Platform';

export type Screen = {
  n: number;
  slug: string;
  label: string;
  group: NavGroup;
  icon: string;
  module: ModuleId;
  summary: string;
  /** The screen's own layout idea: why it is not another copy of the dashboard. */
  layout: string;
  wave: 1 | 2 | 3 | 4 | 5 | 6;
  /** Second key of a "g then key" shortcut. */
  key?: string;
  /** Hidden from the sidebar (reached from another screen). */
  hidden?: boolean;
  /** Product identity colour for connected products and panel brands. */
  brand?: 'sampleon' | 'projexa' | 'zapx' | 't2o' | 'mfr' | 'mho';
};

export const groups: { id: NavGroup; icon: string }[] = [
  { id: 'Command', icon: 'Orbit' },
  { id: 'Panels', icon: 'LayoutGrid' },
  { id: 'Respondents', icon: 'Users' },
  { id: 'Audiences', icon: 'Target' },
  { id: 'Surveys & fieldwork', icon: 'Rocket' },
  { id: 'Connected products', icon: 'Waypoints' },
  { id: 'Engagement', icon: 'Send' },
  { id: 'Rewards & support', icon: 'Wallet' },
  { id: 'Platform', icon: 'Settings2' },
];

export const screens: Screen[] = [
  // ── Command
  { n: 1, slug: 'executive', label: 'Executive Dashboard', group: 'Command', icon: 'Gauge', module: 'command-center', wave: 1, key: 'd',
    summary: 'Supply health, fieldwork in flight and the decisions waiting on you.',
    layout: 'Supply Orbit hero (concentric funnel rings) beside six live KPIs, a fieldwork flight deck of audience requests, an inline decision queue, panel brand cards and hourly completes.' },
  { n: 2, slug: 'global-intelligence', label: 'Global Panel Intelligence', group: 'Command', icon: 'Globe2', module: 'command-center', wave: 6, key: 'g',
    summary: 'Country-level respondent distribution and survey activity.',
    layout: 'Optional interactive 3D globe with arcs for live survey traffic and a fast 2D choropleth alternative; country drawer with panel mix, reachability and quotas.' },
  { n: 37, slug: 'copilot', label: 'AI Copilot Command Center', group: 'Command', icon: 'Sparkles', module: 'command-center', wave: 6,
    summary: 'Ask, plan and act across SUPPLY360 in plain language.',
    layout: 'Conversation canvas with structured answer cards (counts, charts, filters), a proposed-actions tray that needs explicit approval and a running context rail.' },
  { n: 38, slug: 'analytics', label: 'Analytics & Reporting', group: 'Command', icon: 'ChartColumnBig', module: 'analytics', wave: 6,
    summary: 'Cohorts, funnels and scheduled supply reports.',
    layout: 'Report builder: metric shelf on the left, pivot canvas in the centre, schedule and export panel on the right; saved reports gallery.' },
  { n: 30, slug: 'notifications', label: 'Notification Center', group: 'Command', icon: 'Bell', module: 'communications', wave: 4,
    summary: 'Everything that needs attention, grouped and snoozable.',
    layout: 'Inbox-zero list with priority lanes (Act, Review, FYI), inline actions, snooze and per-channel delivery rules.' },

  // ── Panels
  { n: 3, slug: 'turn2opinion', label: 'Turn2Opinion', group: 'Panels', icon: 'CircleDot', module: 'panels', wave: 2, brand: 't2o',
    summary: 'Consumer panel operations for Turn2Opinion.',
    layout: 'Brand-tinted panel cockpit: membership funnel, recruitment sources, survey card performance and a brand settings strip.' },
  { n: 4, slug: 'myfrequentrewards', label: 'MyFrequentRewards', group: 'Panels', icon: 'Gift', module: 'panels', wave: 2, brand: 'mfr',
    summary: 'Rewards-first consumer panel operations.',
    layout: 'Loyalty-tier view: tier pyramid, points economy (earned vs redeemed), streaks and weekly rewards survey uptake.' },
  { n: 5, slug: 'myhealthopinions', label: 'MyHealthOpinions', group: 'Panels', icon: 'HeartPulse', module: 'panels', wave: 2, brand: 'mho',
    summary: 'Healthcare professional and patient panel operations.',
    layout: 'Specialty matrix (specialty × country), credential verification queue and compliance (honoraria caps, consent) indicators.' },

  // ── Respondents
  { n: 6, slug: 'panellists', label: 'Panellist Database Explorer', group: 'Respondents', icon: 'Table2', module: 'panels', wave: 2, key: 'p',
    summary: 'Search, filter and act on every panellist across the three panels.',
    layout: 'Dense, virtualised data grid with saved views, customisable columns, facet rail, bulk actions with confirmation and a peek drawer.' },
  { n: 7, slug: 'panellists/profile', label: 'Panellist 360° Profile', group: 'Respondents', icon: 'UserRound', module: 'panels', wave: 2, hidden: true,
    summary: 'One respondent, everything about them.',
    layout: 'Compact identity panel, interactive profile sections, engagement history, rewards timeline and an operational action rail.' },
  { n: 8, slug: 'registration', label: 'Registration & Verification', group: 'Respondents', icon: 'BadgeCheck', module: 'panels', wave: 2,
    summary: 'Sign-up funnel, identity checks and manual review.',
    layout: 'Funnel strip on top, verification review queue with side-by-side evidence, and rule outcomes (email, device, IP, document).' },
  { n: 9, slug: 'profile-automation', label: 'Profile Completion Automation', group: 'Respondents', icon: 'Wand2', module: 'panels', wave: 2,
    summary: 'Close profiling gaps automatically.',
    layout: 'Gap heatmap (attribute × panel) with one-click nudge campaigns, progressive-profiling rules and lift tracking.' },
  { n: 10, slug: 'profiling/demographic', label: 'Demographic Profiling Studio', group: 'Respondents', icon: 'Shapes', module: 'panels', wave: 2,
    summary: 'Design and maintain demographic profile questions.',
    layout: 'Question library tree, live respondent preview, coverage by country and attribute versioning.' },
  { n: 11, slug: 'profiling/b2b', label: 'B2B Profiling Studio', group: 'Respondents', icon: 'Briefcase', module: 'panels', wave: 2,
    summary: 'Job title, industry, company size and decision role.',
    layout: 'Taxonomy mapper (raw titles to normalised roles), seniority × industry coverage grid and verification signals.' },
  { n: 12, slug: 'profiling/healthcare', label: 'Healthcare Profiling Studio', group: 'Respondents', icon: 'Stethoscope', module: 'panels', wave: 2,
    summary: 'Specialties, conditions and professional credentials.',
    layout: 'Specialty ontology browser, condition prevalence vs panel coverage, credential-check status per country.' },
  { n: 35, slug: 'quality-risk', label: 'Quality & Risk Intelligence', group: 'Respondents', icon: 'ShieldAlert', module: 'panels', wave: 5,
    summary: 'Fraud, duplicates, speeders and account health.',
    layout: 'Risk radar by signal, case queue with evidence timeline, rule tuning with backtest and reversible actions.' },
  { n: 36, slug: 'activity', label: 'Panellist Activity Timeline', group: 'Respondents', icon: 'History', module: 'panels', wave: 5,
    summary: 'Every event, across every respondent, in order.',
    layout: 'Streaming event log with lanes by type, scrubber, filters and jump-to-profile.' },

  // ── Audiences
  { n: 13, slug: 'segmentation', label: 'AI Audience Segmentation', group: 'Audiences', icon: 'Boxes', module: 'panels', wave: 2, key: 'a',
    summary: 'Build audiences with nested filters or plain language.',
    layout: 'Split-screen audience builder: nested AND/OR filter tree with live counts on the left, demographic charts on the right, AI natural-language input on top.' },
  { n: 14, slug: 'feasibility', label: 'Audience Feasibility Studio', group: 'Audiences', icon: 'Calculator', module: 'panels', wave: 2, key: 'f',
    summary: 'Will this audience deliver, and how fast?',
    layout: 'Scenario columns side by side (IR, LOI, completes, fatigue), country waterfall from eligible to achievable, and a confidence band.' },
  { n: 15, slug: 'distribution', label: 'Global Audience Distribution', group: 'Audiences', icon: 'Map', module: 'panels', wave: 6,
    summary: 'Where the reachable audience is, by country and panel.',
    layout: '2D map with proportional symbols, panel stacks per country and a time-zone wake band for send planning.' },

  // ── Surveys & fieldwork
  { n: 16, slug: 'surveys', label: 'Survey Inventory', group: 'Surveys & fieldwork', icon: 'ListChecks', module: 'panels', wave: 3,
    summary: 'Every survey available to panellists, from every source.',
    layout: 'Kanban-by-status with a table toggle, source chips (PROJEXA, ZAPX, partner), CPI, IR, LOI and quota health.' },
  { n: 17, slug: 'survey-generation', label: 'AI Survey Generation', group: 'Surveys & fieldwork', icon: 'FileStack', module: 'panels', wave: 4,
    summary: 'Draft profiling and engagement surveys with AI.',
    layout: 'Brief on the left, generated questionnaire in the centre with per-question rationale, quality checks on the right.' },
  { n: 18, slug: 'weekly-rewards', label: 'Weekly Rewards Surveys', group: 'Surveys & fieldwork', icon: 'CalendarHeart', module: 'panels', wave: 4,
    summary: 'The recurring weekly survey programme.',
    layout: 'Week calendar strip, programme health (uptake, cost per complete), and a template carousel.' },
  { n: 22, slug: 'routing', label: 'Survey Routing Intelligence', group: 'Surveys & fieldwork', icon: 'Route', module: 'panels', wave: 3, key: 'r',
    summary: 'How respondents move between surveys.',
    layout: 'Interactive routing graph: entry → eligibility decisions → surveys (quota state) → validated outcomes, with path replay.' },
  { n: 23, slug: 'launch', label: 'Soft Launch & Full Launch', group: 'Surveys & fieldwork', icon: 'Rocket', module: 'panels', wave: 3, key: 'l',
    summary: 'Launch safely, then scale.',
    layout: 'Launch checklist rail, soft-launch read-out (IR, LOI, drop-off vs plan) and a gated full-launch control with confirmation.' },
  { n: 24, slug: 'batches', label: 'Batch Scheduling', group: 'Surveys & fieldwork', icon: 'CalendarClock', module: 'panels', wave: 3,
    summary: 'Plan invitation waves by time zone.',
    layout: 'Timeline (Gantt) of batches per country with drag to reschedule, send-window guards and throttle previews.' },
  { n: 25, slug: 'quotas', label: 'Quota Monitoring', group: 'Surveys & fieldwork', icon: 'Target', module: 'panels', wave: 3, key: 'q',
    summary: 'Every quota cell, on pace or not.',
    layout: 'Quota matrix (cells coloured by pace), burn-down per cell and auto-actions (close, boost, re-batch).' },

  // ── Connected products
  { n: 19, slug: 'sampleon', label: 'SAMPLEON Audience Allocation', group: 'Connected products', icon: 'Waypoints', module: 'marketplace', wave: 6, brand: 'sampleon', key: 's',
    summary: 'Cross-platform supply operations.',
    layout: 'Request pipeline from PROJEXA and ZAPX: feasibility, allocation, quotas, batches and fieldwork progress in one workspace.' },
  { n: 20, slug: 'projexa-requests', label: 'PROJEXA Audience Requests', group: 'Connected products', icon: 'FolderKanban', module: 'marketplace', wave: 6, brand: 'projexa',
    summary: 'Audience requests raised by PROJEXA projects.',
    layout: 'Request inbox with project context (client, milestones, budget) and accept / counter-propose actions.' },
  { n: 21, slug: 'zapx-requests', label: 'ZAPX Audience Requests', group: 'Connected products', icon: 'Zap', module: 'marketplace', wave: 6, brand: 'zapx',
    summary: 'Audience requests raised directly from ZAPX surveys.',
    layout: 'Survey-first request cards (survey preview, redirects, QA status) with feasibility and launch approval.' },

  // ── Engagement
  { n: 26, slug: 'automation', label: 'Engagement Automation Builder', group: 'Engagement', icon: 'Workflow', module: 'automation', wave: 4,
    summary: 'Trigger, condition, delay, action.',
    layout: 'Node-based workflow editor with triggers, conditions, delays and actions, test-run preview and execution logs.' },
  { n: 27, slug: 'email', label: 'Email Campaign Designer', group: 'Engagement', icon: 'Mail', module: 'communications', wave: 4,
    summary: 'Design, target and send campaigns.',
    layout: 'Block editor with live desktop/mobile preview, audience and consent check, send-time optimiser and A/B setup.' },
  { n: 28, slug: 'newsletters', label: 'Newsletter Studio', group: 'Engagement', icon: 'Newspaper', module: 'communications', wave: 4,
    summary: 'Recurring panel newsletters.',
    layout: 'Issue board (draft → review → scheduled → sent), content library and per-panel brand templates.' },
  { n: 29, slug: 'journeys', label: 'Respondent Lifecycle Journeys', group: 'Engagement', icon: 'Milestone', module: 'automation', wave: 4,
    summary: 'From sign-up to loyal respondent.',
    layout: 'Swimlane journey map by lifecycle stage with conversion between stages and the automations attached to each.' },

  // ── Rewards & support
  { n: 31, slug: 'rewards', label: 'Rewards & Wallet Management', group: 'Rewards & support', icon: 'Wallet', module: 'panels', wave: 5, key: 'w',
    summary: 'Points, balances and the immutable ledger.',
    layout: 'Financial operations view: liability by panel, immutable ledger with transaction statuses and reconciliation against payouts.' },
  { n: 32, slug: 'redemptions', label: 'Redemption Approval Center', group: 'Rewards & support', icon: 'BadgeDollarSign', module: 'panels', wave: 5,
    summary: 'Approve, hold or reject payouts.',
    layout: 'Approval queue with risk score, respondent context and batched approve with confirmation and undo window.' },
  { n: 33, slug: 'support', label: 'Support Ticket Management', group: 'Rewards & support', icon: 'LifeBuoy', module: 'panels', wave: 5, key: 't',
    summary: 'Resolve respondent cases fast.',
    layout: 'Three-pane workspace: ticket list, conversation, respondent context; macros and SLA timers.' },
  { n: 34, slug: 'support-ai', label: 'AI Support Assistant', group: 'Rewards & support', icon: 'Bot', module: 'panels', wave: 5,
    summary: 'Drafted replies and auto-resolution, with review.',
    layout: 'Suggestion review lane (accept / edit / reject), knowledge sources used per answer and deflection metrics.' },

  // ── Platform
  { n: 39, slug: 'api-hub', label: 'API Integration Hub', group: 'Platform', icon: 'Plug', module: 'integrations', wave: 6,
    summary: 'Keys, webhooks and connected systems.',
    layout: 'Connection map (SUPPLY360 ↔ SAMPLEON, PROJEXA, ZAPX, panels), event delivery log with retry and API key management.' },
  { n: 40, slug: 'roles', label: 'User Roles & Permissions', group: 'Platform', icon: 'KeyRound', module: 'admin', wave: 6,
    summary: 'Who can see and do what.',
    layout: 'Role × capability matrix with diff preview before saving, and per-user overrides with expiry.' },
  { n: 41, slug: 'settings', label: 'System Settings', group: 'Platform', icon: 'Settings2', module: 'admin', wave: 6,
    summary: 'Tenant, panels, locales and limits.',
    layout: 'Searchable settings index with sections, change history and safe-mode preview for risky settings.' },
  { n: 42, slug: 'theme-studio', label: 'Theme Customization Studio', group: 'Platform', icon: 'Palette', module: 'design-system', wave: 1,
    summary: 'Choose a theme, density, text size and motion.',
    layout: 'Live theme gallery with a real component preview, contrast checks, density and motion controls; saved to your profile.' },
];

export const visibleScreens = screens.filter((s) => !s.hidden);
export const screenHref = (s: Screen) => `/supply/${s.slug}`;
export const screenByPath = (path: string | null | undefined) =>
  path ? [...screens].sort((a, b) => b.slug.length - a.slug.length).find((s) => path === screenHref(s) || path.startsWith(`${screenHref(s)}/`)) : undefined;
export const screenBySlug = (slug: string) => screens.find((s) => s.slug === slug);
/** Screens with a finished implementation in this build; the rest show their design brief. */
export const BUILT_WAVES = [1, 2, 3, 4, 5] as const;
export const isScreenBuilt = (s: Screen) => (BUILT_WAVES as readonly number[]).includes(s.wave);

export const brandColors: Record<NonNullable<Screen['brand']>, { name: string; color: string; ink: string }> = {
  sampleon: { name: 'SAMPLEON', color: '#14B8A6', ink: '#ffffff' },
  projexa: { name: 'PROJEXA', color: '#F59E0B', ink: '#1a1203' },
  zapx: { name: 'ZAPX', color: '#EC4899', ink: '#ffffff' },
  t2o: { name: 'Turn2Opinion', color: '#4D86FF', ink: '#ffffff' },
  mfr: { name: 'MyFrequentRewards', color: '#A855F7', ink: '#ffffff' },
  mho: { name: 'MyHealthOpinions', color: '#10B981', ink: '#ffffff' },
};

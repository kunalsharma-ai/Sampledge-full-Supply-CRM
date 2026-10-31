import type { ModuleId } from './core';

export type ModuleDef = {
  id: ModuleId;
  label: string;
  href: string;
  icon: string; // lucide icon name, resolved in shell/icons.tsx
  group: 'Operate' | 'Research' | 'Commercial' | 'Platform';
  phase: 2 | 3 | 4 | 5 | 6; // phase in which the module's dashboard lands
  blurb: string;
};

export const modules: ModuleDef[] = [
  { id: 'command-center', label: 'Command Center', href: '/command-center', icon: 'Orbit', group: 'Operate', phase: 2, blurb: 'Executive control center across the whole research ecosystem.' },
  { id: 'projects', label: 'Projects', href: '/projects', icon: 'KanbanSquare', group: 'Operate', phase: 2, blurb: 'Lifecycle, Gantt, quotas and delivery risk.' },
  { id: 'automation', label: 'AI Automation', href: '/automation', icon: 'Bot', group: 'Operate', phase: 2, blurb: 'Agents, workflows, approvals and execution logs.' },
  { id: 'communications', label: 'Comms Hub', href: '/communications', icon: 'MessagesSquare', group: 'Operate', phase: 4, blurb: 'Outbound messages, templates, consent-filtered sends and delivery log.' },

  { id: 'survey-studio', label: 'Survey Studio', href: '/survey-studio', icon: 'Workflow', group: 'Research', phase: 2, blurb: 'Programming, visual logic, preview and automated QA.' },
  { id: 'panels', label: 'Panels', href: '/panels', icon: 'Users', group: 'Research', phase: 2, blurb: 'Turn2Opinion, MyFrequentRewards and MyHealthOpinions.' },
  { id: 'data-processing', label: 'Data Processing', href: '/data-processing', icon: 'Database', group: 'Research', phase: 6, blurb: 'Cleaning, coding, weighting and tabulation.' },
  { id: 'analytics', label: 'Insight Studio', href: '/analytics', icon: 'ChartScatter', group: 'Research', phase: 2, blurb: 'Crosstabs, significance, segmentation and reporting.' },
  { id: 'diy', label: 'DIY Research', href: '/diy', icon: 'Sparkles', group: 'Research', phase: 5, blurb: 'Self-service study configuration and launch.' },

  { id: 'crm', label: 'Bidding CRM', href: '/crm', icon: 'Target', group: 'Commercial', phase: 2, blurb: 'RFQs, quotes, pipeline and AI bid assistant.' },
  { id: 'marketplace', label: 'Sample Exchange', href: '/marketplace', icon: 'Globe2', group: 'Commercial', phase: 2, blurb: 'Supplier performance, CPI and AI allocation.' },
  { id: 'finance', label: 'Finance', href: '/finance', icon: 'Landmark', group: 'Commercial', phase: 4, blurb: 'Invoices, purchase orders, vendor payables and approvals.' },
  { id: 'client-portal', label: 'Client Portal', href: '/client-portal', icon: 'Building2', group: 'Commercial', phase: 4, blurb: 'What clients see: progress, deliverables, approvals.' },
  { id: 'vendor-portal', label: 'Vendor Portal', href: '/vendor-portal', icon: 'Truck', group: 'Commercial', phase: 4, blurb: 'What suppliers see: opportunities, allocations, payments.' },

  { id: 'integrations', label: 'Integrations', href: '/integrations', icon: 'Plug', group: 'Platform', phase: 6, blurb: 'Adapters for panels, email, storage and BI.' },
  { id: 'admin', label: 'Admin & Security', href: '/admin', icon: 'ShieldCheck', group: 'Platform', phase: 6, blurb: 'People and roles, sessions, audit trail and security posture.' },
  { id: 'design-system', label: 'Design System', href: '/design-system', icon: 'Palette', group: 'Platform', phase: 2, blurb: 'Tokens, themes and the component library.' },
];

/** True when the module has a working screen (planned modules route to /modules/<id>). */
export const isBuilt = (m: ModuleDef) => !m.href.startsWith('/modules/');

export const moduleById = (id: ModuleId) => modules.find((m) => m.id === id)!;

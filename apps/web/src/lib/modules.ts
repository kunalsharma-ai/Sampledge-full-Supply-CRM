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
  { id: 'communications', label: 'Comms Hub', href: '/modules/communications', icon: 'MessagesSquare', group: 'Operate', phase: 4, blurb: 'Project threads, mentions, approvals and timelines.' },

  { id: 'survey-studio', label: 'Survey Studio', href: '/survey-studio', icon: 'Workflow', group: 'Research', phase: 2, blurb: 'Programming, visual logic, preview and automated QA.' },
  { id: 'panels', label: 'Panels', href: '/panels', icon: 'Users', group: 'Research', phase: 2, blurb: 'Turn2Opinion, MyFrequentRewards and MyHealthOpinions.' },
  { id: 'data-processing', label: 'Data Processing', href: '/modules/data-processing', icon: 'Database', group: 'Research', phase: 4, blurb: 'Cleaning, coding, weighting and tabulation.' },
  { id: 'analytics', label: 'Insight Studio', href: '/analytics', icon: 'ChartScatter', group: 'Research', phase: 2, blurb: 'Crosstabs, significance, segmentation and reporting.' },
  { id: 'diy', label: 'DIY Research', href: '/modules/diy', icon: 'Sparkles', group: 'Research', phase: 4, blurb: 'Self-service study configuration and launch.' },

  { id: 'crm', label: 'Bidding CRM', href: '/crm', icon: 'Target', group: 'Commercial', phase: 2, blurb: 'RFQs, quotes, pipeline and AI bid assistant.' },
  { id: 'marketplace', label: 'Sample Exchange', href: '/marketplace', icon: 'Globe2', group: 'Commercial', phase: 2, blurb: 'Supplier performance, CPI and AI allocation.' },
  { id: 'finance', label: 'Finance', href: '/modules/finance', icon: 'Landmark', group: 'Commercial', phase: 4, blurb: 'Quotes, POs, invoices, reconciliation and margin.' },
  { id: 'client-portal', label: 'Client Portal', href: '/modules/client-portal', icon: 'Building2', group: 'Commercial', phase: 4, blurb: 'What clients see: progress, deliverables, approvals.' },
  { id: 'vendor-portal', label: 'Vendor Portal', href: '/modules/vendor-portal', icon: 'Truck', group: 'Commercial', phase: 4, blurb: 'What suppliers see: opportunities, allocations, payments.' },

  { id: 'integrations', label: 'Integrations', href: '/modules/integrations', icon: 'Plug', group: 'Platform', phase: 6, blurb: 'Adapters for panels, email, storage and BI.' },
  { id: 'admin', label: 'Admin & Security', href: '/modules/admin', icon: 'ShieldCheck', group: 'Platform', phase: 6, blurb: 'Tenants, RBAC, SSO, audit and retention.' },
  { id: 'design-system', label: 'Design System', href: '/design-system', icon: 'Palette', group: 'Platform', phase: 2, blurb: 'Tokens, themes and the component library.' },
];

export const moduleById = (id: ModuleId) => modules.find((m) => m.id === id)!;

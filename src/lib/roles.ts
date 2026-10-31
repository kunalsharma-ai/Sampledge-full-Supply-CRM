/**
 * Role matrix: single source of truth for navigation visibility and field-level redaction.
 * docs/ROLE_MATRIX.md is written from this file. In Phase 3 the same permission keys are
 * enforced server-side (NestJS guards + Postgres row-level security); in Phase 2 they only
 * drive the UI.
 */
export type Role =
  | 'platform_admin'
  | 'executive'
  | 'project_manager'
  | 'survey_programmer'
  | 'bizdev'
  | 'data_processing'
  | 'finance'
  | 'panel_manager'
  | 'vendor'
  | 'client';

export const roles: { id: Role; label: string; persona: string }[] = [
  { id: 'executive', label: 'Executive', persona: 'Avery Chen (Demo) · COO' },
  { id: 'platform_admin', label: 'Platform Admin', persona: 'Sam Rivera (Demo)' },
  { id: 'project_manager', label: 'Project Manager', persona: 'Priya Nair (Demo)' },
  { id: 'survey_programmer', label: 'Survey Programmer', persona: 'Jonas Weber (Demo)' },
  { id: 'bizdev', label: 'Business Development', persona: 'Lena Ortiz (Demo)' },
  { id: 'data_processing', label: 'Data Processing', persona: 'Marco Bianchi (Demo)' },
  { id: 'finance', label: 'Finance & Ops', persona: 'Grace Okafor (Demo)' },
  { id: 'panel_manager', label: 'Panel Manager', persona: 'Hana Sato (Demo)' },
  { id: 'vendor', label: 'Sample Vendor', persona: 'Atlas Sample Co. (Demo)' },
  { id: 'client', label: 'Client', persona: 'Northwind Brands (Demo)' },
];

export type ModuleId =
  | 'command-center' | 'survey-studio' | 'diy' | 'marketplace' | 'panels' | 'crm' | 'projects'
  | 'data-processing' | 'analytics' | 'client-portal' | 'vendor-portal' | 'finance' | 'automation'
  | 'communications' | 'integrations' | 'admin' | 'design-system';

export type Permission =
  | 'view:margins'        // internal margins, CPI cost vs sell
  | 'view:vendor_bids'    // all vendors' bids (vendors see only their own)
  | 'view:panelist_pii'   // panelist identity (never in demo)
  | 'approve:quotes'
  | 'approve:publish'
  | 'approve:purchase'
  | 'approve:payments'
  | 'edit:surveys'
  | 'edit:projects'
  | 'edit:automations';

type Access = 'full' | 'read' | 'scoped' | 'none';

/** module access per role. "scoped" = only records the role is party to. */
export const moduleAccess: Record<ModuleId, Record<Role, Access>> = {
  'command-center':  { platform_admin: 'full', executive: 'full', project_manager: 'read', survey_programmer: 'none', bizdev: 'read', data_processing: 'none', finance: 'read', panel_manager: 'none', vendor: 'none', client: 'none' },
  'survey-studio':   { platform_admin: 'full', executive: 'read', project_manager: 'read', survey_programmer: 'full', bizdev: 'none', data_processing: 'read', finance: 'none', panel_manager: 'none', vendor: 'none', client: 'scoped' },
  diy:               { platform_admin: 'full', executive: 'read', project_manager: 'read', survey_programmer: 'none', bizdev: 'read', data_processing: 'none', finance: 'none', panel_manager: 'none', vendor: 'none', client: 'full' },
  marketplace:       { platform_admin: 'full', executive: 'read', project_manager: 'full', survey_programmer: 'none', bizdev: 'full', data_processing: 'none', finance: 'read', panel_manager: 'read', vendor: 'scoped', client: 'none' },
  panels:            { platform_admin: 'full', executive: 'read', project_manager: 'read', survey_programmer: 'none', bizdev: 'none', data_processing: 'none', finance: 'read', panel_manager: 'full', vendor: 'none', client: 'none' },
  crm:               { platform_admin: 'full', executive: 'read', project_manager: 'read', survey_programmer: 'none', bizdev: 'full', data_processing: 'none', finance: 'read', panel_manager: 'none', vendor: 'none', client: 'none' },
  projects:          { platform_admin: 'full', executive: 'read', project_manager: 'full', survey_programmer: 'read', bizdev: 'read', data_processing: 'read', finance: 'read', panel_manager: 'read', vendor: 'none', client: 'scoped' },
  'data-processing': { platform_admin: 'full', executive: 'none', project_manager: 'read', survey_programmer: 'read', bizdev: 'none', data_processing: 'full', finance: 'none', panel_manager: 'none', vendor: 'none', client: 'none' },
  analytics:         { platform_admin: 'full', executive: 'full', project_manager: 'full', survey_programmer: 'read', bizdev: 'read', data_processing: 'full', finance: 'read', panel_manager: 'read', vendor: 'none', client: 'scoped' },
  'client-portal':   { platform_admin: 'full', executive: 'read', project_manager: 'full', survey_programmer: 'none', bizdev: 'read', data_processing: 'none', finance: 'none', panel_manager: 'none', vendor: 'none', client: 'full' },
  'vendor-portal':   { platform_admin: 'full', executive: 'read', project_manager: 'full', survey_programmer: 'none', bizdev: 'read', data_processing: 'none', finance: 'read', panel_manager: 'none', vendor: 'full', client: 'none' },
  finance:           { platform_admin: 'full', executive: 'full', project_manager: 'read', survey_programmer: 'none', bizdev: 'read', data_processing: 'none', finance: 'full', panel_manager: 'none', vendor: 'scoped', client: 'scoped' },
  automation:        { platform_admin: 'full', executive: 'read', project_manager: 'full', survey_programmer: 'read', bizdev: 'read', data_processing: 'read', finance: 'read', panel_manager: 'full', vendor: 'none', client: 'none' },
  communications:    { platform_admin: 'full', executive: 'full', project_manager: 'full', survey_programmer: 'full', bizdev: 'full', data_processing: 'full', finance: 'full', panel_manager: 'full', vendor: 'scoped', client: 'scoped' },
  integrations:      { platform_admin: 'full', executive: 'read', project_manager: 'none', survey_programmer: 'none', bizdev: 'none', data_processing: 'read', finance: 'none', panel_manager: 'read', vendor: 'none', client: 'none' },
  admin:             { platform_admin: 'full', executive: 'read', project_manager: 'none', survey_programmer: 'none', bizdev: 'none', data_processing: 'none', finance: 'none', panel_manager: 'none', vendor: 'none', client: 'none' },
  'design-system':   { platform_admin: 'full', executive: 'full', project_manager: 'full', survey_programmer: 'full', bizdev: 'full', data_processing: 'full', finance: 'full', panel_manager: 'full', vendor: 'full', client: 'full' },
};

const perms: Record<Role, Permission[]> = {
  platform_admin: ['view:margins', 'view:vendor_bids', 'approve:quotes', 'approve:publish', 'approve:purchase', 'approve:payments', 'edit:surveys', 'edit:projects', 'edit:automations'],
  executive: ['view:margins', 'view:vendor_bids', 'approve:quotes', 'approve:purchase', 'approve:payments'],
  project_manager: ['view:margins', 'view:vendor_bids', 'approve:purchase', 'edit:projects', 'edit:automations'],
  survey_programmer: ['edit:surveys'],
  bizdev: ['view:margins', 'view:vendor_bids', 'approve:quotes'],
  data_processing: [],
  finance: ['view:margins', 'view:vendor_bids', 'approve:payments'],
  panel_manager: ['edit:automations'],
  vendor: [],
  client: ['approve:publish'],
};

export const can = (role: Role, p: Permission) => perms[role].includes(p);
export const access = (role: Role, m: ModuleId): Access => moduleAccess[m][role];
export const permissionsFor = (role: Role) => perms[role];

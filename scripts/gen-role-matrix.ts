// Writes docs/ROLE_MATRIX.md from src/lib/roles.ts so the doc can never drift from the code.
import { writeFileSync } from 'node:fs';
import { moduleAccess, permissionsFor, roles } from '../src/lib/roles.ts';
const mods = Object.keys(moduleAccess) as (keyof typeof moduleAccess)[];
const sym = { full: 'Full', read: 'Read', scoped: 'Scoped', none: '—' } as const;
let md = '# User role matrix\n\nGenerated from `src/lib/roles.ts` (`npm run docs:roles`). **Scoped** = only records the user is party to (a vendor sees its own bids/allocations; a client sees its own projects).\n\n';
md += '| Module | ' + roles.map((r) => r.label).join(' | ') + ' |\n|---|' + roles.map(() => '---').join('|') + '|\n';
for (const m of mods) md += `| ${m} | ` + roles.map((r) => sym[moduleAccess[m][r.id]]).join(' | ') + ' |\n';
md += '\n## Permissions\n\n| Role | Permissions |\n|---|---|\n';
for (const r of roles) md += `| ${r.label} | ${permissionsFor(r.id).map((p) => '`' + p + '`').join(', ') || '—'} |\n`;
md += '\n## Visibility rules\n\n- Vendors never see competing vendors’ bids, CPIs or client identity before award.\n- Clients never see internal margins, cost CPIs or supplier agreements (`view:margins`).\n- Panelists never see internal project information.\n- Healthcare panel data requires separate consent and is never exposed in aggregate below a minimum cell size.\n- Consequential actions (quotes, purchases, payments, publishing, dataset release, deletes, bulk comms, respondent rejection) always require a human with the matching `approve:*` permission.\n';
writeFileSync(new URL('../docs/ROLE_MATRIX.md', import.meta.url), md);
console.log('docs/ROLE_MATRIX.md written');

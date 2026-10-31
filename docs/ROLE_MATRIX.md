# User role matrix

Generated from `packages/core/src/roles.ts` (`npm run docs:roles -w @sampledge/web`). The same matrix drives the web navigation and the API guards: `none` returns 403, `read` refuses writes. **Scoped** = only records the user is party to (a vendor sees its own bids/allocations; a client sees its own projects).

| Module | Executive | Platform Admin | Project Manager | Survey Programmer | Business Development | Data Processing | Finance & Ops | Panel Manager | Sample Vendor | Client |
|---|---|---|---|---|---|---|---|---|---|---|
| command-center | Full | Full | Read | — | Read | — | Read | — | — | — |
| survey-studio | Read | Full | Read | Full | — | Read | — | — | — | Scoped |
| diy | Read | Full | Read | — | Read | — | — | — | — | Full |
| marketplace | Read | Full | Full | — | Full | — | Read | Read | Scoped | — |
| panels | Read | Full | Read | — | — | — | Read | Full | — | — |
| crm | Read | Full | Read | — | Full | — | Read | — | — | — |
| projects | Read | Full | Full | Read | Read | Read | Read | Read | — | Scoped |
| data-processing | — | Full | Read | Read | — | Full | — | — | — | — |
| analytics | Full | Full | Full | Read | Read | Full | Read | Read | — | Scoped |
| client-portal | Read | Full | Full | — | Read | — | — | — | — | Full |
| vendor-portal | Read | Full | Full | — | Read | — | Read | — | Full | — |
| finance | Full | Full | Read | — | Read | — | Full | — | Scoped | Scoped |
| automation | Read | Full | Full | Read | Read | Read | Read | Full | — | — |
| communications | Full | Full | Full | Full | Full | Full | Full | Full | Scoped | Scoped |
| integrations | Read | Full | — | — | — | Read | — | Read | — | — |
| admin | Read | Full | — | — | — | — | — | — | — | — |
| design-system | Full | Full | Full | Full | Full | Full | Full | Full | Full | Full |

## Permissions

| Role | Permissions |
|---|---|
| Executive | `view:margins`, `view:vendor_bids`, `approve:quotes`, `approve:purchase`, `approve:payments` |
| Platform Admin | `view:margins`, `view:vendor_bids`, `approve:quotes`, `approve:publish`, `approve:purchase`, `approve:payments`, `edit:surveys`, `edit:projects`, `edit:automations` |
| Project Manager | `view:margins`, `view:vendor_bids`, `approve:purchase`, `edit:projects`, `edit:automations` |
| Survey Programmer | `edit:surveys` |
| Business Development | `view:margins`, `view:vendor_bids`, `approve:quotes` |
| Data Processing | — |
| Finance & Ops | `view:margins`, `view:vendor_bids`, `approve:payments` |
| Panel Manager | `edit:automations` |
| Sample Vendor | — |
| Client | `approve:publish` |

## Visibility rules

- Vendors never see competing vendors’ bids, CPIs or client identity before award.
- Clients never see internal margins, cost CPIs or supplier agreements (`view:margins`).
- Panelists never see internal project information.
- Healthcare panel data requires separate consent and is never exposed in aggregate below a minimum cell size.
- Consequential actions (quotes, purchases, payments, publishing, dataset release, deletes, bulk comms, respondent rejection) always require a human decision. Deciders by kind: quotes `approve:quotes`, purchases `approve:purchase`, payments `approve:payments`, publishing `approve:publish`, respondent rejection `edit:projects`, bulk comms `edit:automations`, dataset release and record deletion Platform Admin or Executive. The requester can never decide their own request (`apps/api/src/common/approvals.ts`).

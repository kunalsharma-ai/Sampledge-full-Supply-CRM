# Turn2Opinion panel backend adapter

Sampledge connects to the Turn2Opinion backend, the one service behind Turn2Opinion (`t2o`), MyFrequentRewards (`mfr`) and MyHealthOpinions (`mho`). The adapter was written from the backend's API description in [`turn2opinion-openapi.yaml`](turn2opinion-openapi.yaml), supplied on 2026-10-31.

**Status: built and tested against a local stand-in of the backend only.** It has not been run against the real backend. It does nothing until a panel is configured.

## Configuration (API server)
| Variable | Meaning |
|---|---|
| `PANEL_T2O_URL`, `PANEL_MFR_URL`, `PANEL_MHO_URL` | Base URL per panel, e.g. `https://t2o.sampledge.duckdns.org` (staging) or `https://www.turn2opinion.com` |
| `PANEL_T2O_TOKEN`, `PANEL_MFR_TOKEN`, `PANEL_MHO_TOKEN` | Long-lived app token issued by that panel's backend (`/api/v1/user/apps`). Tokens only work on the host that issued them, so each panel needs its own |
| `PANEL_BACKEND_TENANT` | Slug of the workspace allowed to use the connection (default `sampledge-demo`) |
| `PANEL_TIMEOUT_MS` | Per-request timeout (default 15000) |
| `PANEL_SAMPLEDGE_PATH` | Where the panel mounted its Sampledge routes (default `/api/v1/sampledge`) |
| `PANEL_IMPORT_INTERVAL_MS` | How often the worker imports responses for synced projects (default 0 = only from the screen) |
| `PANEL_IMPORT_MAX_PAGES` | Pages per import run (default 20, 200 responses each) |

A panel with no URL or no token shows as **Not connected**, and every call to it is refused with 503.

## What Sampledge calls
| Sampledge | Backend | Notes |
|---|---|---|
| Connection check | `GET /api/v1/me/` | Confirms the token is accepted |
| CPI quote | `POST /api/v1/cpi/` `{category, subcategory, ir, loi, country}` | The only body the description defines. The reply is shown unchanged |
| CPI categories, filter options | `GET /api/v1/cpi/categories`, `GET /api/v1/feasibility/options/{country}/{field}` | |
| Feasibility count | `POST /api/v1/feasibility/` | The filter is passed through unchanged, because its format is not described |
| Project status, qualified respondents | `GET /api/v1/project/{id}`, `/qualified` | |
| Schedule invites | `POST /api/v1/project/{id}` | **Needs approval** (High-volume communications) |
| Soft launch | `PATCH /api/v1/project/{id}` | **Needs approval** (High-volume communications) |
| Cancel project | `DELETE /api/v1/project/{id}` | **Needs approval** (Deleting records) |

Approved actions become a `PanelCall` row, and the outbox worker sends each one **at most once**. The worker claims the row before sending, so a crash mid-request is never followed by an automatic resend. A call still marked `sending` after 10 minutes is set to `needs_review`. The panel team is notified of every result. If the panel is not connected, the call is recorded as `not_sent`.

Errors from the backend come back as 502 with the backend's message, never as 401 or 403, so they are not mistaken for the user's own Sampledge session failing. A 403 from the backend is explained as a token issued for a different panel host.

## Project sync and response import (v0.11.0)
The panel team was sent a patch for their backend (models, migration and `routes/sampledge.js`; copy in [`panel-backend-patch/`](panel-backend-patch/)) that adds the routes below, in the formats from the agreed requirements doc. Sampledge calls them under `PANEL_SAMPLEDGE_PATH` (default `/api/v1/sampledge`).

| Sampledge | Panel route | Notes |
|---|---|---|
| Reach check | `POST /feasibility` `{country, filters, activeWithinDays}` | Counts panelists who are consented to invitations, active and recently active |
| Sync project | `PUT /project` | One market per country (`<code>-<country>`), quotas per market. Sends no invitations |
| Panel status | `GET /project/{pid}` | Counts per market and quota, incidence, median length |
| Import responses | `GET /project/{pid}/responses?cursor=` | Pages from the saved cursor; upserts `PanelResponse`, so re-running never double counts |
| Respondent profile, profile questions | `GET /respondent-profile/{id}`, `GET /questions` | Pseudonymous only |

How a project is translated:
- Quota conditions on `gender`, `age` and `region` become panel filters automatically. Other conditions (on survey questions the panel does not know) are listed in the preview, and the sync is refused until someone gives panel filters for them.
- The target is split evenly across countries unless completes per market are given. Quota targets are scaled to each market's share.
- Incidence is sent as a percentage (Sampledge stores a fraction). CPI sent is the project's cost CPI.
- Imported rows keep only respondentID, outcome, quality reasons, times, device and the pseudonymous profile (country, region, age band, gender, category). Anything else the panel sends is dropped.
- Imported counts are shown beside the project's own and never overwrite `Project.completes`, which also counts other suppliers.
- Import runs from the screen, or every `PANEL_IMPORT_INTERVAL_MS` in the worker (off by default), at most `PANEL_IMPORT_MAX_PAGES` pages per run.

Tested against a local stand-in of these routes (8 tests); the routes themselves were tested on the panel side against MongoDB 7 (20 tests). **Not yet run against the live panels.**

## Still needed from the backend
- `POST /api/v1/project/{id}` and `PATCH /api/v1/project/{id}`: the invite and soft-launch bodies. Until then they are typed by the requester and sent unchanged once approved.
- `POST /api/v1/user/apps`: app sign-in, if tokens should be renewed automatically rather than configured.

## Security observations on the description (for the backend team)
If the description reflects the running service, these routes accept requests with **no sign-in**:
- `GET /api/v1/survey/responses/{slug}`: every respondent response for a survey
- `GET /api/v1/integration/respondent-profile/{respondentID}`: a respondent's profile and answers
- `PATCH /api/v1/survey/response`: changes a respondent's status, which can affect rewards
- `PUT`/`DELETE /api/v1/survey/{id}`, `/question/*`, `/option/*`, `/category/*`, `DELETE /api/v1/profile/{id}`
- all of `/api/v1/project-dev/*`, including scheduling invites and cancelling projects
- `POST /email`: sends mail to any address; `POST /email/verify`: takes SMTP credentials
- `POST /api/v1/user/refresh`, `PATCH`/`DELETE /api/v1/user/apps`, `GET /api/v1/user/birthday/today`

MyHealthOpinions holds health-related answers, and the backend handles minors (parental consent routes), so these are worth checking first. They may only be missing from the description.

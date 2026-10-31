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

## Not built yet: waiting on the backend's formats
The description types most request and response bodies only as `object`. Before Sampledge can fill these in or read them, it needs one real example of the request and the reply for each of:
- `PUT /api/v1/project/`: create or sync a project from Sampledge
- `POST /api/v1/feasibility/`: the filter format
- `POST /api/v1/project/{id}` and `PATCH /api/v1/project/{id}`: the invite and soft-launch bodies
- `POST /api/v1/user/apps`: app sign-in, if tokens should be renewed automatically rather than configured
- `PUT /api/v1/integration/new-survey` and `POST /api/v1/integration/response/{responseID}`: survey and response hand-off

Until then, the invite and soft-launch bodies are typed by the requester in the backend's own format and sent unchanged once approved.

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

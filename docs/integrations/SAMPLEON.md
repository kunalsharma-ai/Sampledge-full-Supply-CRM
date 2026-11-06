# SAMPLEON ↔ SUPPLY360

> **Name change:** SAMPLEON is now shown to people as **SampAudience** (by Sampledge). Screens use the new name and logo (`apps/web/public/brand/sampaudience/`); API paths, env vars, the client id `sampleon` and event source `SAMPLEON` are unchanged. See `docs/BRAND.md` in the Sampleon repository.

SAMPLEON (repository `kunalsharma-ai/Sampleon`) is the Sampledge audience, invitation and routing
engine. The full ecosystem design is SAMPLEON's `docs/ECOSYSTEM_ARCHITECTURE.md`; this page is
SUPPLY360's side.

**Ownership.** SUPPLY360 stays the only respondent database: panelists of Turn2Opinion,
MyFeedbackRewards and My Health Opinions, their profiles (including B2B and healthcare
attributes), consent, activity history, e-mail and notifications, rewards and quality. SAMPLEON
never receives a name or e-mail address: it works with `respondentRef` (the panelist id), panel and
country, and asks SUPPLY360 to count, select, check and deliver.

## Settings

| Variable | Meaning |
|---|---|
| `SAMPLEON_SECRET` | Shared secret with SAMPLEON. Verifies SAMPLEON's calls and signs SUPPLY360's calls to SAMPLEON. Comma-separate two values while rotating (the first one signs) |
| `SAMPLEON_CLIENT_ID` | Client id SAMPLEON signs with (default `sampleon`) |
| `SUPPLY360_CLIENT_ID` | Client id SUPPLY360 signs with at SAMPLEON (default `supply360`) |
| `SAMPLEON_URL` | SAMPLEON base URL, for `reward.eligibility_confirmed` |
| `SAMPLEON_TENANT` | Workspace slug whose panelists SAMPLEON may use (default `PANEL_BACKEND_TENANT`, then `sampledge-demo`) |
| `PANEL_CARDS_SECRET_T2O` / `_MFR` / `_MHO` | Each panel website's own secret for its survey-card feed |

## API — `/api/v1/s2s/supply`

Every request is signed (`X-Sampledge-Client`, `X-Sampledge-Timestamp`,
`X-Sampledge-Signature: v1=hex HMAC-SHA256(secret, ts.METHOD.path.sha256(body))`, 300 seconds).

| Method | Path | Caller | Does |
|---|---|---|---|
| GET | `/attributes` | SAMPLEON | Attribute catalogue (key, type, values, synonyms, sensitivity) from `integrations/sampleon/attributes.ts` |
| POST | `/eligibility/count` | SAMPLEON | `eligible`, `reachable`, `missingProfile`, `byPanel` for one country |
| POST | `/eligibility/select` | SAMPLEON | Up to `limit` reachable respondents, random order |
| POST | `/eligibility/check` | SAMPLEON | One respondent: eligible, reasons, matching quota ids, consent (routing) |
| POST | `/deliveries` | SAMPLEON | Survey cards (and one Comms Hub e-mail per panel) for consenting respondents; others `suppressed` with a reason. Replays are harmless |
| GET | `/panel/{panel}/cards?respondentRef=` | That panel's website | Open cards for one respondent, only for its own panel |
| POST | `/events` | SAMPLEON | `survey.started/completed/screenout`, `quality.failed`, `project.closed` → `Participation`, card status, `IncentiveEntry` rewards, reversals; deduplicated by `eventId` |

**Rules applied inside SUPPLY360**

- Only `research_participation` consent (latest grant or withdrawal wins), active accounts, active
  within `activeWithinDays`, not suspended or deletion-requested, count as reachable.
- Health attributes only match panelists with `health_data` consent; only match/no-match leaves
  SUPPLY360.
- Exclusions (`audienceRequestIds`, `surveyIds`) and the fatigue cap (also the workspace's weekly
  invitation cap) use SUPPLY360's own `SurveyCard` and `Participation` history.
- Rewards are posted once per verified complete and reversed on a later `quality.failed`; each
  posting is confirmed to SAMPLEON through the outbox (`sampleon.event`).

Staff see what SAMPLEON did with the workspace's panelists at `GET /api/v1/panels/sampleon/overview`.

## Tables

`PanelistAttribute`, `SurveyCard`, `Participation`, `InboundEvent` (migration
`20261106090000_sampleon_supply_api`), all with the tenant row-level-security policy.

## Tests

`apps/api/src/test/sampleon.test.ts`, and SAMPLEON's `e2e/ecosystem/run.mjs`, which runs both
workflows against this service, SAMPLEON, ZAPX and PROJEXA together.

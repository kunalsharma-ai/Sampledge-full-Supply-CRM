# Turn2Opinion model changes for the Sampledge integration

These are changes to the Mongoose models you shared on 2026-10-31. Copy `model/`, `integration/` and `migrations/` over your backend's folders of the same names. Alternatively, run `git apply changes.diff` from the folder that holds `model/`.

## Bugs fixed

| File | Fix |
| --- | --- |
| User.js, Respondent.js | `age` compared months twice (`getMonth` used for the day). It now uses the day of the month and the real length of the previous month. |
| Respondent.js | `concent` renamed to `consent`. The migration renames the stored data. |
| Respondent.js | `resetPassword` and `changePassword` now `await this.save()`. |
| Respondent.js | `changePassword` compared against `this.passwordHash`, which is `select:false`, so it is empty after a normal find. It now reads the hash explicitly. |
| User.js, Respondent.js | The admin check read `category` in one model and `role` in the other. Both now use one check that accepts either field, with the same allowed list as before: admin, superadmin and root. |
| Response.js | The methods were passed as `methods`, but every other model uses `method`. Both keys are passed for now. Check which one `utils/mongooseModel` reads and keep only that one. |

## Fields added

| Model | Fields |
| --- | --- |
| User, Respondent | `consents[]` {purpose, granted, at, policyVersion, channel}, with `consentState` updated to match on every save. `accountStatus`, `lastActiveAt`, `unsubscribedAt`, `deletionRequestedAt`. `dedupeKey` (an HMAC of the email, `select:false`). `recruitment` {source, campaign}. `address[].countryCode` and `address[].region`. Virtuals `ageBand` and `isMinor`. Method `hasConsent(purpose)`. |
| User | Virtual `parentalConsentStatus`. |
| Respondent | `hcpVerification` {method, status, verifiedAt}. |
| Response | `project` {pid, marketID, quotaID}. Status `qualityterminate`, with `qualityReasons[]` and `reviewedBy`. `statusChangedAt`. `deviceType`. Method `qualityTerminate(reasons, reviewedBy)`; removing a complete needs a reviewer id. New status values are only checked when a status is written, so older records still load. |
| SurveyProject | `markets[].quotas[]` {quotaID, label, filters, target}. |

## New `integration/` folder

- **`serializers.js`:** `toRespondentProfile` and `toResponseExport` build the response objects from the requirements doc. They copy only the allowed fields. Profile answers are included only with `client_sharing` consent, and on MyHealthOpinions only with `health_data` consent as well.
- **`projectStatus.js`:** `projectStatus({Response, SurveyProject}, pid)` returns counts per market and quota, the median length, the incidence and the time of the last complete.
- **`fields.js`:** `reachableMatch({activeWithinDays})` is the Mongo filter for feasibility counts. It matches panelists who are active, not unsubscribed and have consented to invitations.
- **`country.js`:** maps free-text country names to ISO codes. Names it does not recognise return null rather than a guess.

## New `routes/sampledge.js`

These are the routes Sampledge calls. Mount them once in each panel's app:

```js
import { createSampledgeRouter } from "./routes/sampledge.js";
app.use("/api/v1/sampledge", createSampledgeRouter({
    panel: "t2o",                       // "mfr" on MyFrequentRewards, "mho" on MyHealthOpinions
    authenticate: yourAppTokenCheck,    // your existing middleware for app tokens
    originOf: (req) => req.origin,      // however your app resolves the panel from the host
}));
```

| Route | What it returns |
| --- | --- |
| `POST /feasibility` {country, filters, activeWithinDays} | Total and reachable counts, by gender, age band and region. Filters can be `gender`, `age` {gte, lte}, `ageBand`, `region`, `category` (`respondentType` on MHO), or any profile question name with its option values. |
| `PUT /project` | Creates or updates a project from Sampledge. Sampledge never changes the project status or schedule, and it cannot overwrite a project your team created. |
| `GET /project/:pid` | Counts per market and quota, plus incidence, median length and the time of the last complete. |
| `GET /project/:pid/responses?since=&cursor=&limit=` | Response rows, oldest change first, in pages of up to 500, so Sampledge can poll for changes. |
| `GET /respondent-profile/:respondentID` | The pseudonymous profile. Answers to contact-detail and free-text questions are never included. |
| `GET /questions?category=` | The profile questions Sampledge can filter on, with their options. Phone, email, zipcode, document and free-text questions are left out. |

Every query is limited to the panel that `originOf` returns, so one panel never sees another's data. None of these routes send invitations or change a respondent.

## Before deploying

1. Set `PANEL_DEDUPE_SECRET` to the same value on all three panels. Without it, `dedupeKey` stays empty.
2. Run the migration as a dry run first: `MONGO_URI=... node migrations/2026-10-31-sampledge-fields.js`. Then run it again with `--apply`. It prints the country names it could not map.
3. **Consent for existing panelists.** Existing panelists have no consent records, so `reachableMatch` counts nobody until they do. If your sign-up terms already covered survey invitations, pass `--legacy-consent=<policy version>` to record that. Otherwise, ask panelists to consent again. This is a legal decision for you, and the script does not make it.
4. **Admin callers.** `role` is `select:false` on User, so load the admin with `.select("+role")` before calling `resetPassword`.

## Also noticed, not changed

- On Respondent, `phone` is unique but not sparse, so only one record could ever have no phone. The validator makes phone required, so this only bites on records inserted directly.

## Testing

- **`test/sampledge-fields.test.mjs`:** 11 tests on the models and helpers.
- **`test/routes.test.mjs`:** 9 tests that run every route and the migration against a real MongoDB 7.0. They check that no name, email, phone, address, payment or free-text answer comes back, that panels can't see each other's data, and that the migration is safe to run twice.

All 20 tests pass. They used `test/mongooseModel.stub.js` in place of your `utils/mongooseModel`, which was not shared. That stub adds `origin`, `isActive`, `isDeleted` and timestamps to every model. If yours behaves differently, run the tests against your real one first.

Please also try a staging copy of your database before production.

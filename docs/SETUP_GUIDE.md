# Connecting the outside services: setup guide

This guide covers everything that needs your own credentials or accounts. Each section is independent and can be done in any order. Until a section is done, that feature shows as **Not connected** on **Integrations** (`/integrations`), and the app keeps working without it.

Put the API settings in the API server's environment: `apps/api/.env` on a single server, or your host's secret store. Put web settings in the web app's environment. Restart the API after any change. Never commit `.env` files, and never paste secrets into chat or tickets.

After each section, open **Integrations** as a platform admin and check that the row says **Connected**. It shows each setting only as set or unset, never the value.

## 0. Base settings (do these first, once)

| Setting | Where | Value |
|---|---|---|
| `DATABASE_URL` | API | Postgres 16 connection string for the `sampledge` role. It must not be a superuser or have BYPASSRLS (see [DEPLOYMENT.md](DEPLOYMENT.md#database-roles-row-level-security)) |
| `JWT_SECRET` | API | 32+ random characters, e.g. `openssl rand -base64 48`. Production refuses `dev-` secrets |
| `WEB_ORIGIN` | API | The public web address, e.g. `https://app.sampledge.example` |
| `COOKIE_SECURE` | API | `true` when served over HTTPS |
| `TRUST_PROXY` | API | Number of proxy hops in front of the API, usually `1` |
| `METRICS_TOKEN` | API | Random string, if you scrape `/api/v1/metrics` with Prometheus |
| `API_ORIGIN` | Web | Where the web app forwards `/api/v1`, e.g. `http://api:4000` |
| `NEXT_PUBLIC_DEMO_LOGINS` | Web | `false` outside demos. This hides the demo account switcher |
| `HSTS` | Web | `true` when served over HTTPS |

Then run `npx prisma migrate deploy` in `apps/api`. Create the first workspace with `node dist/tenant.js create`. Do **not** run the seed outside a demo, because it wipes every table.

## 1. Turn2Opinion panels (t2o, mfr, mho)

Two parts are needed: the panel side has to serve the Sampledge routes, and Sampledge needs a token for each panel.

**On the panel backend (your team), staging first:**
1. Apply the patch in [`integrations/panel-backend-patch/`](integrations/panel-backend-patch/), also delivered as `turn2opinion-model-patch.zip`. It contains the model changes, a migration and `routes/sampledge.js`.
2. Mount the router: `app.use('/api/v1/sampledge', createSampledgeRouter({ panel, authenticate, originOf }))`. Use your existing app-token check as `authenticate`.
3. Run the migration. Decide on consent backfill for existing panelists (`--legacy-consent`); that is a legal call.
4. Deploy to staging (`https://{t2o,mfr,mho}.sampledge.duckdns.org`).
5. Issue one app token per panel host with `POST /api/v1/user/apps`. Tokens only work on the host that issued them.
6. Before production, close the routes that the API description lists without sign-in (see [TURN2OPINION.md](integrations/TURN2OPINION.md#security-observations-on-the-description-for-the-backend-team)). The most urgent are `survey/responses/{slug}`, `integration/respondent-profile/{id}`, `PATCH survey/response`, `project-dev/*` and `POST /email`.

**In Sampledge (API):**

| Setting | Value |
|---|---|
| `PANEL_T2O_URL`, `PANEL_MFR_URL`, `PANEL_MHO_URL` | Each panel's base URL (staging first) |
| `PANEL_T2O_TOKEN`, `PANEL_MFR_TOKEN`, `PANEL_MHO_TOKEN` | The token from step 5 for that host |
| `PANEL_BACKEND_TENANT` | The workspace identifier allowed to use the panels (default `sampledge-demo`) |
| `PANEL_IMPORT_INTERVAL_MS` | Optional. E.g. `600000` to import responses every 10 minutes. The default (0) imports only from the screen |

**Check:** on the Panels page, run *Check connection*, then a reach check, then a sync of a test project. Invites and soft launch go through approvals, so nothing is sent to panelists until someone approves.

## 2. Claude (AI features)

1. In the Claude Console (console.anthropic.com), create an API key for a workspace with a spend limit.
2. Set these in the API environment:

| Setting | Value |
|---|---|
| `AI_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | The key |
| `AI_MONTHLY_CAP_USD` | Monthly ceiling enforced by Sampledge (default `50`). When reached, the app falls back to its rule-based answers |

**Check:** on the Automation page the AI gateway card says *Connected: claude-opus-5-5*. Then press *Run on claude-opus-5-5* on the AI evaluation card and compare the scores with the rule-based ones before relying on the model. Margins and costs are only sent for roles allowed to see them.

## 3. Single sign-on (choose one)

People are never created on first sign-in. Add them in **Admin → People** first, with the same e-mail address the provider sends.

**OpenID Connect** (Google Workspace, Entra ID, Okta, Auth0 and others):
1. Register a confidential web app. Set the redirect URI to `https://<web origin>/api/v1/auth/sso/callback`, scopes to `openid email profile`, and turn on PKCE (S256).
2. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` (the redirect URI above), `OIDC_TENANT` (workspace identifier) and optionally `OIDC_LABEL` (button text).

**SAML 2.0** (Okta, Entra ID, Google Workspace, ADFS):
1. Create a SAML app. Import `https://<web origin>/api/v1/auth/saml/metadata`, or enter the ACS URL `https://<web origin>/api/v1/auth/saml/acs` (HTTP-POST) and an entity ID of your choice.
2. Send the e-mail as an `email` attribute or as an e-mail-format NameID, and sign assertions with SHA-256.
3. Set `SAML_ENTRY_POINT` (the provider's SSO URL), `SAML_IDP_ISSUER` (its entity ID), `SAML_IDP_CERT` (its signing certificate, PEM), `SAML_SP_ENTITY_ID`, `SAML_CALLBACK_URL` (the ACS URL), `SAML_TENANT` and optionally `SAML_LABEL`.

**Check:** the sign-in page shows the SSO button. Sign in with a test member first, and check the audit trail shows `auth.login` with the method.

## 4. E-mail (SMTP)

Use your mail provider's SMTP relay (SES, SendGrid, Postmark, Microsoft 365 and others), from a domain with SPF and DKIM set up.

| Setting | Value |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | The relay, e.g. `smtp.sendgrid.net`, `587` |
| `SMTP_SECURE` | `true` for port 465, otherwise `false` (STARTTLS) |
| `SMTP_USER`, `SMTP_PASSWORD` | The relay credentials |
| `SMTP_FROM` | The sender, e.g. `Sampledge <noreply@your-domain>` |

Until both `SMTP_HOST` and `SMTP_FROM` are set, e-mails are recorded on the Communications page but not sent. Deliverable notices and scheduled report e-mails use this too. **Check:** send a test message to yourself from the Communications page. Messages to more than `COMMS_HIGH_VOLUME` recipients need an approval.

## 5. SMS

Any Twilio-compatible API works.

| Setting | Value |
|---|---|
| `SMS_ACCOUNT_SID`, `SMS_AUTH_TOKEN` | The account credentials |
| `SMS_FROM` | A sending number or sender ID registered for your countries |
| `SMS_API_URL` | Only for a non-Twilio compatible provider |

**Check:** send a test SMS to your own number from the Communications page.

## What stays simulated after all of this
The dashboard history series, the brand metrics, and the agent usage figures are labelled demo data. They need their own data sources, which no setting turns on. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

// End-to-end smoke test against the live stack (API + web), run after a fresh seed:
//   npm run db:seed -w @sampledge/api && npm run dev   (then, in another shell)
//   node apps/web/e2e-smoke.cjs
const { chromium } = require('playwright');
const B = process.env.WEB_URL ?? 'http://localhost:3000';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  if (process.env.DEBUG) p.on('response', (r) => { if (r.url().includes('/auth/')) console.log('  ·', r.status(), r.request().method(), r.url().replace(B, '')); });
  let failed = 0;
  const ok = (n, c) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
  const apiGet = (path) => p.evaluate(async (u) => (await fetch(u)).json(), `/api/v1${path}`);
  // Pages render after the session and records load, so wait for the app frame, not just the network.
  const go = async (path) => {
    await p.goto(B + path, { waitUntil: 'networkidle' });
    try { await p.locator('#main').waitFor({ timeout: 20000 }); } catch (e) { await p.screenshot({ path: 'e2e-failure.png' }); throw new Error(`${path}: app frame did not render (url ${p.url()})`); }
    await p.waitForTimeout(300);
  };
  const switchTo = async (role) => {
    await p.getByLabel('Switch demo account').selectOption(role);
    // Wait until the server session is the new role (an earlier toast may still be on screen).
    for (let i = 0; ; i++) {
      if ((await apiGet('/auth/me')).role === role) break;
      if (i > 60) throw new Error(`account switch to ${role} did not complete`);
      await p.waitForTimeout(250);
    }
    await p.locator('#main').waitFor({ timeout: 20000 });
  };

  // 1 Unauthenticated users land on sign-in
  await p.goto(B + '/command-center', { waitUntil: 'networkidle' });
  await p.waitForURL(/\/login/, { timeout: 15000 });
  ok('Signed-out visit redirects to /login', p.url().includes('/login?next=%2Fcommand-center'));

  // 2 Password sign-in
  await p.getByLabel('Work email').fill('bizdev@demo.sampledge.test');
  await p.getByLabel('Password').fill('demo1234');
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(/command-center/, { timeout: 20000 });
  await p.getByText('Live API').waitFor({ timeout: 15000 });
  ok('Password sign-in lands on the requested page', true);

  // 3 CRM Won -> project, persisted in Postgres
  await go('/crm?open=op-001');
  const title = (await p.locator('[role=dialog] .font-display').first().textContent()).trim();
  await p.locator('[role=dialog] button', { hasText: /^Won$/ }).click();
  await p.getByText(/Project SE-26\d+ created/).first().waitFor({ timeout: 15000 });
  await p.reload({ waitUntil: 'networkidle' });
  const projects = await apiGet('/projects');
  ok(`Won deal "${title}" creates a project that survives reload`, projects.some((x) => x.name === title));

  // 4 Lost needs a reason
  await go('/crm?open=op-002');
  await p.locator('[role=dialog] button', { hasText: /^Lost$/ }).click();
  await p.getByText('Why was it lost?').waitFor();
  await p.locator('[role=dialog] button', { hasText: /^Timeline$/ }).click();
  await p.waitForTimeout(1200);
  const op2 = await apiGet('/opportunities/op-002');
  ok('Marking Lost records the loss reason', op2.stage === 'Lost' && op2.lossReason === 'Timeline');

  // 5 Assistant answers from records
  await go('/command-center');
  await p.getByRole('button', { name: 'Show projects likely to miss their deadlines.' }).first().click();
  await p.waitForTimeout(800);
  ok('Assistant answers with sources', await p.getByText(/Traced to \d+ record/).first().isVisible());

  // 6 Survey programmer: QA fix saves a new server version, then publish goes to approval
  await switchTo('survey_programmer');
  const vr = await apiGet('/surveys/sv-cloud/versions'); if (!Array.isArray(vr)) console.log('versions response', vr);
  const v0 = vr.length;
  await go('/survey-studio?tab=qa');
  await p.getByRole('button', { name: /Approve fix/ }).first().click();
  await p.waitForTimeout(1500);
  const v1 = (await apiGet('/surveys/sv-cloud/versions')).length;
  ok(`QA fix saved as a new version (${v0} → ${v1})`, v1 === v0 + 1);
  await p.getByRole('button', { name: /Request publish/ }).click();
  await p.getByText(/approval queue/).first().waitFor({ timeout: 10000 });
  ok('Publish request goes to the approval queue', true);

  // 7 Admin approves; survey goes live
  await switchTo('platform_admin');
  await go('/automation');
  const card = p.locator('div.panel-solid', { hasText: 'Publish Cloud Security Buyer Study' });
  await card.getByRole('button', { name: /Approve/ }).click();
  await p.getByText(/respondent links are live/).first().waitFor({ timeout: 10000 });
  ok('Admin approval publishes the survey', (await apiGet('/surveys/sv-cloud')).status === 'Published');

  // 8 Respondent runtime (public page, server-side routing)
  const r = await b.newPage();
  await r.goto(B + '/r/sv-cloud?src=e2e', { waitUntil: 'networkidle' });
  await r.getByRole('button', { name: 'Not employed' }).click();
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByText('Thanks for your time').waitFor({ timeout: 10000 });
  ok('Respondent link screens out by routing rule', true);
  await r.close();

  // 9 Vendor scope
  await switchTo('vendor');
  await go('/command-center');
  ok('Vendor role blocked from Command Center', await p.getByText(/is not available to Sample Vendor/).isVisible());
  const vs = await apiGet('/vendors');
  ok('API returns only the vendor\'s own record', vs.length === 1 && vs[0].id === 'vd-01');
  await go('/marketplace');
  ok('Vendor sees only own workspace', (await p.content()).includes('Vendor workspace') && !(await p.content()).includes('Vendor leaderboard'));

  // 10 Sign out
  await p.getByRole('button', { name: 'Sign out' }).click();
  await p.waitForURL(/\/login/, { timeout: 10000 });
  const me = await p.evaluate(async () => (await fetch('/api/v1/auth/me')).status);
  ok('Sign out revokes the session', me === 401);

  console.log('page errors:', errs.length, errs.slice(0, 3));
  await b.close();
  process.exit(failed || errs.length ? 1 : 0);
})().catch(async (e) => { console.error(e.message.split('\n')[0]); process.exit(1); });

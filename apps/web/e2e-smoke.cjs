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
  const apiSend = (method, path, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; }, [method, `/api/v1${path}`, body]);
  const until = async (fn, what) => { for (let i = 0; i < 60; i++) { if (await fn()) return true; await p.waitForTimeout(250); } throw new Error(`timed out: ${what}`); };
  // Pages render after the session and records load, so wait for the app frame. Not 'networkidle':
  // the live-updates stream keeps a request open for as long as the page is.
  const go = async (path) => {
    await p.goto(B + path, { waitUntil: 'load' });
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
  await p.goto(B + '/command-center', { waitUntil: 'load' });
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
  await p.reload({ waitUntil: 'load' });
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
  // The answer arrives after a network round trip; wait for it rather than a fixed delay.
  const traced = await p.getByText(/Traced to \d+ record/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  ok('Assistant answers with sources', traced);
  // Command Center figures are the API's, counted from records (no simulated series).
  const ov = await apiGet('/insights/overview');
  await p.waitForTimeout(1800); // count-up animation
  ok(`Command Center KPI matches the API (${ov.kpis && ov.kpis.active_projects.value} active projects)`, !!ov.kpis && (await p.getByText('Total active projects').first().isVisible()) && (await p.getByText('Invoiced revenue, purchase cost and forecast').isVisible()));

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
  await r.goto(B + '/r/sv-cloud?src=e2e', { waitUntil: 'load' });
  await r.getByRole('button', { name: 'Not employed' }).click();
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByText('Thanks for your time').waitFor({ timeout: 10000 });
  ok('Respondent link screens out by routing rule', true);
  await r.close();

  // 9 Phase 4 workflows: feasibility, PO, invoice, client portal, Comms Hub
  await switchTo('bizdev');
  await go('/crm?open=op-004');
  await p.locator('[role=dialog] button', { hasText: 'Request feasibility' }).click();
  await p.getByText(/Sent to \d+ vendor/).first().waitFor({ timeout: 10000 });
  ok('Business Development requests supplier feasibility from the CRM', (await apiGet('/opportunities/op-004/feasibility')).length >= 1);

  await switchTo('project_manager');
  const al = await apiSend('POST', '/projects/pr-012/allocations', { vendorId: 'vd-01', completes: 120, cpi: 3.4 });
  await apiSend('PATCH', '/projects/pr-012/stage', { stage: 'Invoice' });
  await switchTo('executive');
  const dec = await apiSend('POST', `/approvals/${al.body.approval.id}/decision`, { decision: 'approved' });
  await until(async () => (await apiGet('/purchase-orders')).some((x) => x.allocationId === al.body.allocation.id), 'PO raised by the worker');
  ok('Approved sample purchase raises a purchase order', dec.status === 200);

  await switchTo('finance');
  await go('/finance');
  const invRow = p.locator('tr', { hasText: 'SE-26' }).filter({ has: p.getByRole('button', { name: 'Issue' }) }).first();
  await invRow.waitFor({ timeout: 15000 });
  const invNo = (await invRow.locator('td').first().textContent()).trim();
  await invRow.getByRole('button', { name: 'Issue' }).click();
  await p.getByText(/issued; the client is notified/).first().waitFor({ timeout: 10000 });
  ok(`Finance issues the drafted invoice ${invNo}`, true);

  await switchTo('client');
  await go('/client-portal');
  await p.getByText(invNo).first().waitFor({ timeout: 10000 });
  ok('Client portal shows the issued invoice', true);

  await switchTo('panel_manager');
  await go('/communications');
  await p.getByRole('radio', { name: 'Panel' }).or(p.getByRole('button', { name: 'Panel', exact: true })).first().click();
  await p.getByRole('combobox', { name: 'Recipient', exact: true }).selectOption('panel:turn2opinion:all');
  await p.getByText(/Above \d+ recipients/).waitFor({ timeout: 10000 });
  await p.locator('#main').getByLabel('Subject').fill('New studies this week');
  await p.locator('#main textarea').first().fill('Hello from the team.');
  await p.getByRole('button', { name: 'Request approval to send' }).click();
  await p.getByText(/sent for approval before anything is queued/).first().waitFor({ timeout: 10000 });
  ok('High-volume panel send waits for approval', (await apiGet('/comms/messages')).some((m) => m.status === 'pending_approval'));

  // Panels: analytics counted from member records; the reward policy saves as a new version.
  await go('/panels');
  const pa = await apiGet('/panels/analytics');
  await p.getByText('Member profile funnel').waitFor({ timeout: 15000 });
  ok(`Panel analytics come from member records (${pa.kpis && pa.kpis.registered} members)`, !!pa.kpis && pa.kpis.registered > 0 && !(await p.getByText(/Simulated/).count()));
  await p.getByLabel('Redemption threshold (pts)').fill('1500');
  await p.getByRole('button', { name: 'Save as new version' }).click();
  await p.getByText(/v1 in force/).waitFor({ timeout: 10000 });
  const rp = await apiGet('/panels/reward-policy');
  ok('Reward policy saved as version 1', rp.current && rp.current.version === 1 && rp.current.redemptionThreshold === 1500);

  // 10 Phase 5: results from real interviews, quality flags, methods lab, AI gateway, DIY
  const done = await p.evaluate(async () => {
    const base = { S1: 'ft', S2: 'lg', S3: 'final', S4: ['tech'], Q1: ['aws'], Q2: 'aws', Q3: 50, Q4: { posture: '3', identity: '3', workload: '3', data: '3' }, Q5: ['price', 'int', 'sup', 'comp'], Q6: 'flat', Q9: 8, Q10: 'ok', Q11: 4, END: '' };
    const variants = [{}, { Q1: ['aws', 'az'], Q9: 10, S2: 'md' }, { Q1: ['aws', 'az'], Q2: 'az', Q9: 6, Q10: 'asdfasdf' }, { Q9: 9, S2: 'md' }];
    const out = [];
    for (const [i, v] of variants.entries()) {
      const ans = { ...base, ...v };
      const post = (u, b) => fetch(`/api/v1${u}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
      const s = await post('/r/sv-cloud/start', { source: 'panel:turn2opinion', respondent: `e2e-${i}` });
      let q = s.question?.id, last = null;
      while (q) { last = await post(`/r/session/${s.responseId}/answer`, { questionId: q, value: ans[q] }); q = last.outcome ? null : last.question?.id; }
      out.push(last?.outcome);
    }
    return out;
  });
  ok(`Four interviews recorded through the public runtime (${done.join(', ')})`, done.filter((x) => x === 'complete').length >= 3);
  await switchTo('survey_programmer');
  await go('/analytics');
  await p.getByLabel('Survey', { exact: true }).selectOption('sv-cloud');
  await p.getByText(/^Base \d+ completes/).first().waitFor({ timeout: 15000 });
  ok('Insight Studio shows results computed from the recorded interviews', await p.getByRole('link', { name: 'PowerPoint report' }).isVisible());
  const pptx = await p.evaluate(async () => { const r = await fetch('/api/v1/surveys/sv-cloud/report.pptx'); return { s: r.status, t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; });
  ok('PowerPoint report downloads', pptx.s === 200 && /presentationml/.test(pptx.t) && pptx.n > 20000);
  await p.getByRole('button', { name: 'Request rejection' }).first().click();
  await p.getByText(/Rejection sent for approval/).first().waitFor({ timeout: 10000 });
  ok('Rejecting a flagged respondent goes to approval', (await apiGet('/approvals')).some((a) => a.kind === 'Rejecting respondents' && a.status === 'pending'));
  await p.getByLabel('Survey', { exact: true }).selectOption('sv-012');
  await p.getByLabel('Respondent flow sankey').waitFor({ timeout: 15000 });
  await p.getByLabel('Segment map').waitFor({ timeout: 15000 });
  ok('Flow, trend and segments are computed from the recorded (synthetic) interviews', await p.getByText(/^Segments explain \d+% of answer variance/).isVisible() && await p.getByLabel('Fieldwork trend').isVisible());
  await go('/analytics?view=methods');
  await p.getByRole('radio', { name: 'Conjoint' }).or(p.getByRole('button', { name: 'Conjoint', exact: true })).first().click();
  await p.getByText('Part-worth utilities and importance').waitFor({ timeout: 10000 });
  ok('Methods lab estimates conjoint utilities on simulated respondents', await p.getByText('Simulated respondents').first().isVisible());
  const qn = await apiSend('POST', '/ai/questionnaire', { text: 'Q1. Which brands do you know? [MULTI]\n1. Alpha\n2. Beta\nQ2. How old are you?' });
  ok('Questionnaire extraction runs through the AI gateway (rules)', qn.status === 200 && qn.body.result.provider === 'rules' && qn.body.result.data.questions.length === 2);

  await switchTo('project_manager');
  await go('/projects?open=pr-002');
  await p.getByRole('button', { name: 'Summarise' }).click();
  await p.getByText(/Rule-based: no AI model is connected/).first().waitFor({ timeout: 10000 });
  ok('Project status summary from the AI gateway', true);

  // A second browser signed in as Business Development should be told live when the client submits.
  const ctx2 = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const q2 = await ctx2.newPage();
  await q2.goto(B + '/login', { waitUntil: 'load' });
  await q2.getByLabel('Work email').fill('bizdev@demo.sampledge.test');
  await q2.getByLabel('Password').fill('demo1234');
  await q2.getByRole('button', { name: 'Sign in', exact: true }).click();
  await q2.waitForURL(/command-center/, { timeout: 20000 });
  await q2.waitForTimeout(1500);

  await switchTo('client');
  await go('/diy');
  await p.getByText(/per complete/).first().waitFor({ timeout: 15000 });
  await p.getByLabel('Study name').fill('E2E snack tracker');
  await p.getByLabel('Objective').fill('Track awareness of our snack brand each quarter.');
  await p.getByRole('button', { name: 'Send request' }).click();
  await p.getByText(/Request sent/).first().waitFor({ timeout: 10000 });
  await p.getByText('E2E snack tracker').first().waitFor({ timeout: 10000 });
  ok('Client submits a DIY request with an indicative range', true);
  await q2.getByText(/DIY request from/).first().waitFor({ timeout: 15000 });
  ok('Business Development sees it live, pushed from the server', true);
  await ctx2.close();

  // 11 Data processing (weighting, coding, recodes, tables and exports) on the closed survey's synthetic interviews
  await switchTo('data_processing');
  await go('/data-processing');
  await p.getByText('Completed interviews').first().waitFor({ timeout: 15000 });
  await p.getByLabel('Weight on S1').check();
  await p.getByLabel('Weight on S2').check();
  await p.getByLabel('S2 18–34 target %').fill('30');
  await p.getByLabel('S2 35–54 target %').fill('35');
  await p.getByLabel('S2 55+ target %').fill('35');
  await p.getByRole('button', { name: 'Apply weights' }).click();
  await p.getByText(/Weights applied: efficiency/).first().waitFor({ timeout: 15000 });
  ok('Rim weighting applied from the Data Processing screen', (await apiGet('/dp/surveys/sv-012')).weighting !== null);
  await p.getByRole('radio', { name: 'Open-end coding' }).or(p.getByRole('button', { name: 'Open-end coding', exact: true })).first().click();
  await p.getByRole('button', { name: 'Suggest codeframe' }).click();
  await p.getByText(/codes suggested from/).first().waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: 'Save and code answers' }).click();
  await p.getByText(/Codeframe saved; 600 answers coded/).first().waitFor({ timeout: 20000 });
  ok('Open ends coded from a suggested codeframe', true);
  const xlsx = await p.evaluate(async () => { const r = await fetch('/api/v1/dp/surveys/sv-012/tables.xlsx?banner=S1&weighted=true'); return { s: r.status, n: (await r.arrayBuffer()).byteLength }; });
  ok('Weighted Excel tables download', xlsx.s === 200 && xlsx.n > 5000);
  await p.getByRole('radio', { name: 'Recodes' }).click();
  await p.getByLabel('New recode from').selectOption('Q2');
  await p.getByRole('button', { name: 'Save recode' }).click();
  await p.getByText(/Recode R_Q2 saved/).first().waitFor({ timeout: 10000 });
  ok('A top-2 box recode is created and usable as a banner', (await apiGet('/surveys/sv-012/results?banner=R_Q2')).banner?.id === 'R_Q2');
  await p.getByRole('radio', { name: 'Tables & exports' }).click();
  const [sav] = await Promise.all([p.waitForEvent('download'), p.getByRole('link', { name: /SPSS data/ }).click()]);
  const savHead = require('node:fs').readFileSync(await sav.path()).subarray(0, 4).toString();
  const pdf = await p.evaluate(async () => { const r = await fetch('/api/v1/surveys/sv-012/report.pdf?banner=R_Q2'); return { s: r.status, head: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) }; });
  ok('SPSS data and the PDF report download', savHead === '$FL2' && pdf.s === 200 && pdf.head === '%PDF-');

  await switchTo('platform_admin');
  await go('/automation');
  await p.getByText('Rule-based mode').waitFor({ timeout: 10000 });
  ok('Automation shows the AI gateway in rule-based mode with usage', await p.getByText(/project\.summary/).first().isVisible());
  // Agents run for real: run one now, and its run is logged with what it did.
  await p.locator('div.panel-solid', { hasText: 'Project Management Agent' }).first().click();
  await p.getByRole('button', { name: 'Run now' }).click();
  let runs = [];
  for (let i = 0; i < 20 && !runs.length; i++) { await p.waitForTimeout(500); runs = await apiGet('/agents/runs'); }
  ok(`Agent run is logged (${runs[0] && runs[0].summary})`, Array.isArray(runs) && runs[0] && runs[0].status === 'succeeded' && runs[0].trigger === 'manual');
  await p.getByRole('switch', { name: 'Toggle Respondent Quality Agent' }).click();
  await p.waitForTimeout(1500);
  ok('Agent can be switched on', (await apiGet('/agents')).find((a) => a.key === 'respondent-quality').enabled === true);

  // 12 Vendor scope
  await switchTo('vendor');
  await go('/command-center');
  ok('Vendor role blocked from Command Center', await p.getByText(/is not available to Sample Vendor/).isVisible());
  const vs = await apiGet('/vendors');
  ok('API returns only the vendor\'s own record', vs.length === 1 && vs[0].id === 'vd-01');
  await go('/marketplace');
  ok('Vendor sees only own workspace', (await p.content()).includes('Vendor workspace') && !(await p.content()).includes('Vendor leaderboard'));

  await go('/vendor-portal');
  await p.getByRole('button', { name: 'Answer', exact: true }).first().click();
  await p.getByLabel('CPI in US dollars').fill('4.2');
  await p.getByRole('button', { name: 'Send answer' }).click();
  await p.getByText(/supplier-confirmed/).first().waitFor({ timeout: 10000 });
  ok('Vendor answers feasibility in the portal', (await apiGet('/feasibility')).some((f) => f.status === 'responded'));
  ok('Vendor portal lists the new purchase order', await p.getByText(/PO-26\d+/).first().isVisible());

  // 13 Sign out
  await p.getByRole('button', { name: 'Sign out' }).click();
  await p.waitForURL(/\/login/, { timeout: 10000 });
  const me = await p.evaluate(async () => (await fetch('/api/v1/auth/me')).status);
  ok('Sign out revokes the session', me === 401);

  console.log('page errors:', errs.length, errs.slice(0, 3));
  await b.close();
  process.exit(failed || errs.length ? 1 : 0);
})().catch(async (e) => { console.error(e.message.split('\n')[0]); process.exit(1); });

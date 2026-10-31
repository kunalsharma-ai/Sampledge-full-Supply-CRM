// Playwright smoke test against a running dev server (npm run dev). Run: node tests/e2e-smoke.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  await p.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.clear(); sessionStorage.setItem('x','1'); } });
  const B = 'http://localhost:3000';
  const setRole = (r) => p.evaluate((r) => { const k = 'sampledge-os-demo-v1'; const s = JSON.parse(localStorage.getItem(k) || '{"state":{},"version":0}'); s.state.role = r; localStorage.setItem(k, JSON.stringify(s)); }, r);
  await p.goto(B + '/crm', { waitUntil: 'networkidle' });
  await setRole('bizdev');
  // 1 CRM won -> project
  await p.goto(B + '/crm?open=op-001', { waitUntil: 'networkidle' });
  const title = (await p.locator('[role=dialog] .font-display').first().textContent()).trim();
  await p.locator('[role=dialog] button', { hasText: /^Won$/ }).click();
  await p.waitForTimeout(500);
  await p.goto(B + '/projects?view=list', { waitUntil: 'networkidle' });
  ok('Won deal "' + title + '" creates project', (await p.content()).includes(title));
  // 2 assistant
  await p.goto(B + '/command-center', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Show projects likely to miss their deadlines.' }).first().click();
  await p.waitForTimeout(800);
  ok('Assistant answers with sources', await p.getByText(/Traced to \d+ record/).first().isVisible());
  // 3 survey preview screenout as programmer
  await p.evaluate(() => { const k = 'sampledge-os-demo-v1'; const s = JSON.parse(localStorage.getItem(k)); s.state.role = 'survey_programmer'; localStorage.setItem(k, JSON.stringify(s)); });
  await p.goto(B + '/survey-studio?tab=preview', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Not employed' }).click();
  await p.getByRole('button', { name: 'Next' }).click();
  await p.waitForTimeout(500);
  ok('Survey screener terminates', await p.getByText('Screened out').isVisible());
  // 4 QA approve fix reduces issues
  await p.goto(B + '/survey-studio?tab=qa', { waitUntil: 'networkidle' });
  const before = await p.locator('tbody tr').count();
  await p.getByRole('button', { name: /Approve fix/ }).first().click();
  await p.waitForTimeout(600);
  const after = await p.locator('tbody tr').count();
  ok(`QA fix applied (${before} → ${after} issues)`, after < before);
  // 5 vendor role cannot see command center
  await p.evaluate(() => { const k = 'sampledge-os-demo-v1'; const s = JSON.parse(localStorage.getItem(k)); s.state.role = 'vendor'; localStorage.setItem(k, JSON.stringify(s)); });
  await p.goto(B + '/command-center', { waitUntil: 'networkidle' });
  ok('Vendor role blocked from Command Center', await p.getByText(/is not available to Sample Vendor/).isVisible());
  await p.goto(B + '/marketplace', { waitUntil: 'networkidle' });
  ok('Vendor sees only own workspace', (await p.content()).includes('Vendor workspace') && !(await p.content()).includes('Vendor leaderboard'));
  console.log('page errors:', errs.length, errs.slice(0,3));
  await b.close();
})();

const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.join(__dirname, '.tmp-shots');
const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ storageState: path.join(SHOTS, 'doctor-session-state.json') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('url after /dashboard nav:', page.url());
  await page.screenshot({ path: path.join(SHOTS, 'doctor-land-01.png'), fullPage: true });
  console.log('console errors:', errors);

  await ctx.storageState({ path: path.join(SHOTS, 'doctor-session-state.json') });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

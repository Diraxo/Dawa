const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.join(__dirname, '.tmp-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('clerk') && url.includes('sign_ins')) {
      let body = ''; try { body = await res.text(); } catch {}
      console.log(`CLERK RESPONSE ${res.status()} ${url}\n${body.slice(0, 800)}`);
    }
  });

  // Warm the Clerk dev-browser handshake cookie via /sign-in first (proven to
  // work reliably) before navigating to /forgot-password directly, which hit
  // a handshake redirect loop on a completely fresh context.
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const forgotLink = page.getByRole('link', { name: /forgot password/i });
  await forgotLink.waitFor({ state: 'visible', timeout: 15000 });
  await forgotLink.click();
  await page.waitForTimeout(1000);
  console.log('url right after click:', page.url());
  await page.screenshot({ path: path.join(SHOTS, 'forgot-00-after-click.png') });
  await page.waitForURL(/\/forgot-password/, { timeout: 30000 }).catch(e => console.log('waitForURL(forgot-password) failed:', e.message.split('\n')[0]));
  console.log('url after waitForURL attempt:', page.url());
  await page.waitForTimeout(1500);

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.click();
  await emailInput.pressSequentially('garsadstyle@gmail.com', { delay: 20 });

  await page.screenshot({ path: path.join(SHOTS, 'forgot-01-filled.png') });

  const submitBtn = page.getByRole('button', { name: /send reset code/i });
  await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
  await submitBtn.click();

  await page.waitForURL(/\/verify/, { timeout: 15000 }).catch(e => console.log('waitForURL failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOTS, 'forgot-02-verify-page.png') });
  console.log('current url:', page.url());

  await ctx.storageState({ path: path.join(SHOTS, 'forgot-ctx-state.json') });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

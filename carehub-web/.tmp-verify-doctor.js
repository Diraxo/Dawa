const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.join(__dirname, '.tmp-shots');
const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('clerk') && url.includes('sign_ins') && !url.includes('handshake')) {
      let body = ''; try { body = await res.text(); } catch {}
      console.log(`CLERK RESPONSE ${res.status()} ${url}\n${body.slice(0, 500)}`);
    }
  });

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const emailInput = page.locator('#signin-email');
  await emailInput.click();
  await emailInput.pressSequentially('garsadstyle@gmail.com', { delay: 20 });
  const passwordInput = page.locator('#signin-password');
  await passwordInput.click();
  await passwordInput.pressSequentially('Garsad@7', { delay: 20 });

  const submitBtn = page.getByRole('button', { name: 'Sign In →' });
  await submitBtn.waitFor({ state: 'visible' });
  console.log('enabled:', await submitBtn.isEnabled());
  await submitBtn.click();

  await page.waitForURL(/\/(patient|doctor|admin)/, { timeout: 30000 }).catch(e => console.log('waitForURL failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(2000);
  console.log('final url:', page.url());
  console.log('console errors:', errors);
  await page.screenshot({ path: path.join(SHOTS, 'doctor-verify-final.png'), fullPage: true });

  await ctx.storageState({ path: path.join(SHOTS, 'doctor-authed-state.json') });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

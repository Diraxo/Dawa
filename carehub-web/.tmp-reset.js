const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.join(__dirname, '.tmp-shots');
const BASE = 'http://localhost:3001';
const CODE = '060307';
const NEW_PASSWORD = 'Garsad@7';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ storageState: path.join(SHOTS, 'forgot-ctx-state.json') });
  const page = await ctx.newPage();
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('clerk') && (url.includes('sign_ins') || url.includes('reset'))) {
      let body = ''; try { body = await res.text(); } catch {}
      console.log(`CLERK RESPONSE ${res.status()} ${url}\n${body.slice(0, 800)}`);
    }
  });

  await page.goto(`${BASE}/verify?email=${encodeURIComponent('garsadstyle@gmail.com')}&type=forgot`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'reset-01-verify-page.png') });

  const digitInputs = page.locator('input[maxlength="1"]');
  const count = await digitInputs.count();
  console.log('digit input count:', count);
  for (let i = 0; i < CODE.length && i < count; i++) {
    await digitInputs.nth(i).click();
    await digitInputs.nth(i).type(CODE[i], { delay: 50 });
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOTS, 'reset-02-code-entered.png') });

  await page.waitForURL(/\/reset-password/, { timeout: 45000 }).catch(e => console.log('waitForURL(reset-password) failed:', e.message.split('\n')[0]));
  console.log('url now:', page.url());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'reset-03-reset-password-page.png') });

  if (!page.url().includes('/reset-password')) {
    console.log('Not on reset-password yet, trying direct navigation as fallback...');
    await page.goto(`${BASE}/reset-password?email=${encodeURIComponent('garsadstyle@gmail.com')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS, 'reset-03b-direct-nav.png') });
  }

  if (!page.url().includes('/reset-password')) {
    console.log('Still did not reach reset-password page, stopping.');
    await ctx.storageState({ path: path.join(SHOTS, 'forgot-ctx-state.json') });
    await browser.close();
    return;
  }

  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.nth(0).click();
  await pwInputs.nth(0).pressSequentially(NEW_PASSWORD, { delay: 20 });
  await pwInputs.nth(1).click();
  await pwInputs.nth(1).pressSequentially(NEW_PASSWORD, { delay: 20 });
  await page.screenshot({ path: path.join(SHOTS, 'reset-04-password-filled.png') });

  const resetBtn = page.getByRole('button', { name: /reset password/i });
  await resetBtn.waitFor({ state: 'visible', timeout: 5000 });
  const enabled = await resetBtn.isEnabled();
  console.log('reset button enabled:', enabled);
  await resetBtn.click();

  await page.waitForURL(/\/(patient|doctor|admin|role)/, { timeout: 20000 }).catch(e => console.log('waitForURL(final) failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(2000);
  console.log('final url:', page.url());
  await page.screenshot({ path: path.join(SHOTS, 'reset-05-final.png') });

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

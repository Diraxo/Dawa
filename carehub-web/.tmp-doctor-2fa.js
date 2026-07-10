const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.join(__dirname, '.tmp-shots');
const BASE = 'http://localhost:3001';
const CODE = '206429';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ storageState: path.join(SHOTS, 'doctor-authed-state.json') });
  const page = await ctx.newPage();
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('clerk') && url.includes('sign_ins') && !url.includes('handshake')) {
      let body = ''; try { body = await res.text(); } catch {}
      console.log(`CLERK RESPONSE ${res.status()} ${url}\n${body.slice(0, 600)}`);
    }
  });

  await page.goto(`${BASE}/verify?email=${encodeURIComponent('garsadstyle@gmail.com')}&type=signin_2fa`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'doctor2fa-01.png') });

  const digitInputs = page.locator('input[maxlength="1"]');
  await digitInputs.first().waitFor({ state: 'visible', timeout: 10000 });
  await digitInputs.first().click();
  await page.waitForTimeout(300);
  await page.keyboard.type(CODE, { delay: 150 });
  await page.waitForTimeout(2000);

  // Verify all 6 boxes actually got their digit; fill in any gaps directly.
  for (let i = 0; i < CODE.length; i++) {
    const val = await digitInputs.nth(i).inputValue();
    if (val !== CODE[i]) {
      console.log(`box ${i} has '${val}', expected '${CODE[i]}' — fixing`);
      await digitInputs.nth(i).click();
      await digitInputs.nth(i).fill(CODE[i]);
    }
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, 'doctor2fa-02.png') });

  await page.waitForURL(/\/(patient|doctor|admin|dashboard)/, { timeout: 30000 }).catch(e => console.log('waitForURL failed:', e.message.split('\n')[0]));
  await page.waitForTimeout(2500);
  console.log('final url:', page.url());
  await page.screenshot({ path: path.join(SHOTS, 'doctor2fa-03-final.png'), fullPage: true });

  await ctx.storageState({ path: path.join(SHOTS, 'doctor-session-state.json') });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

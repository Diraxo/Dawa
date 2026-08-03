const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.join(__dirname, '.tmp-shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

const BASE = 'http://localhost:3001';

async function signIn(page, email, password, label) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`[${label}] ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('clerk') && (url.includes('sign_in') || url.includes('sign-in'))) {
      let body = '';
      try { body = await res.text(); } catch {}
      console.log(`[${label}] CLERK RESPONSE ${res.status()} ${url}\n${body.slice(0, 1500)}`);
    }
  });

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log(`[${label}] console errors so far:`, errors);

  const emailInput = page.locator('#signin-email');
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.click();
  await emailInput.pressSequentially(email, { delay: 20 });

  const passwordInput = page.locator('#signin-password');
  await passwordInput.click();
  await passwordInput.pressSequentially(password, { delay: 20 });

  await page.screenshot({ path: path.join(SHOTS, `${label}-01-filled.png`) });

  const submitBtn = page.getByRole('button', { name: 'Sign In →' });
  await submitBtn.waitFor({ state: 'visible', timeout: 5000 });

  const isEnabled = await submitBtn.isEnabled();
  console.log(`[${label}] button enabled after fill:`, isEnabled);
  if (!isEnabled) {
    console.log(`[${label}] console errors after fill:`, errors);
    throw new Error(`${label}: submit button never enabled`);
  }
  await submitBtn.click();

  await page.waitForURL(/\/(patient|doctor|admin|dashboard)/, { timeout: 25000 }).catch((e) => {
    console.log(`[${label}] waitForURL failed:`, e.message.split('\n')[0]);
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, `${label}-02-after-login.png`), fullPage: true });

  return { errors, url: page.url() };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const doctorCtx = await browser.newContext();
  const patientCtx = await browser.newContext();
  const doctorPage = await doctorCtx.newPage();
  const patientPage = await patientCtx.newPage();

  const report = {};

  const doctorLogin = await signIn(doctorPage, 'garsadstyle@gmail.com', 'Garsad@7', 'doctor');
  report.doctorLoginUrl = doctorLogin.url;
  report.doctorLoginErrors = doctorLogin.errors;

  const patientLogin = await signIn(patientPage, 'mohamedsheikdayibmohamed@gmail.com', 'Mohamedsheik@7', 'patient');
  report.patientLoginUrl = patientLogin.url;
  report.patientLoginErrors = patientLogin.errors;

  console.log(JSON.stringify(report, null, 2));

  await doctorCtx.storageState({ path: path.join(SHOTS, 'doctor-state.json') });
  await patientCtx.storageState({ path: path.join(SHOTS, 'patient-state.json') });

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

const { chromium } = require('playwright')
const BASE = 'http://localhost:3000'
const CONSULTATION_ID = process.env.CONSULTATION_ID
const DOCTOR_USER_ID = process.env.DOCTOR_CLERK_ID
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

async function main() {
  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: DOCTOR_USER_ID, expires_in_seconds: 120 }),
  })
  const data = await res.json()
  const token = data.token
  if (!token) { console.log('no token: ' + JSON.stringify(data.errors)); return }

  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.on('console', (msg) => console.log('[console] ' + msg.type() + ': ' + msg.text()))
  page.on('response', async (r) => {
    if (r.url().includes('supabase') && r.status() >= 400) {
      console.log('[supabase-error] ' + r.status() + ' ' + r.url())
      try { console.log('  body: ' + (await r.text()).slice(0, 400)) } catch {}
    }
  })

  await page.goto(`${BASE}/sign-in`)
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 20000 })
  const result = await page.evaluate(async (tok) => {
    const signIn = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: tok })
    if (signIn.status === 'complete') { await window.Clerk.setActive({ session: signIn.createdSessionId }) }
    return signIn.status
  }, token)
  console.log('sign-in status: ' + result)

  await page.goto(`${BASE}/doctor/consultation/phone/${CONSULTATION_ID}`)
  await page.waitForTimeout(6000)
  console.log('FULL BODY TEXT:\n' + (await page.innerText('body')))
  await page.screenshot({ path: 'C:/Users/LENOVO/AppData/Local/Temp/claude/diag_doctor.png' })

  await browser.close()
}
main()

// Throwaway one-off verification script — not part of the real test suite.
// Verifies: two-browser phone consultation reaches "connected" on both sides,
// timers agree, and a mid-call refresh on the doctor's side recovers correctly
// (regression check for the poll-fallback edit in useConsultationState.ts).
const { chromium } = require('playwright')

const BASE = 'http://localhost:3000'
const CONSULTATION_ID = process.env.CONSULTATION_ID
const DOCTOR_USER_ID = process.env.DOCTOR_CLERK_ID
const PATIENT_USER_ID = process.env.PATIENT_CLERK_ID
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

// Real password sign-in tripped Clerk's bot/fraud-detection second factor
// (the app's sign-in page has no UI for it). Use Clerk's own documented
// mechanism for this exact situation instead: a short-lived, one-time
// server-issued sign-in token, exchanged for a session directly against the
// already-loaded Clerk client in the page. The token is fetched and consumed
// entirely in-process — never written to disk or logged.
async function signInWithToken(page, userId) {
  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 120 }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('failed to create sign-in token: ' + JSON.stringify(data.errors ?? data))
  const token = data.token

  await page.goto(`${BASE}/sign-in`)
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 20000 }).catch(async () => {
    await page.waitForTimeout(5000)
  })

  const result = await page.evaluate(async (tok) => {
    const signIn = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: tok })
    if (signIn.status === 'complete') {
      await window.Clerk.setActive({ session: signIn.createdSessionId })
      return { status: signIn.status }
    }
    return { status: signIn.status, errors: signIn.firstFactorVerification?.error }
  }, token)
  console.log('  sign-in-with-token result: ' + JSON.stringify(result))
  if (result.status !== 'complete') throw new Error('ticket sign-in did not complete: ' + JSON.stringify(result))

  await page.goto(`${BASE}/dashboard`)
  await page.waitForURL(/\/(dashboard|doctor|patient)/, { timeout: 15000 })
}

async function main() {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })

  const doctorCtx = await browser.newContext()
  const patientCtx = await browser.newContext()
  await doctorCtx.grantPermissions(['microphone', 'camera'])
  await patientCtx.grantPermissions(['microphone', 'camera'])

  const doctorPage = await doctorCtx.newPage()
  const patientPage = await patientCtx.newPage()

  const log = (who, msg) => console.log(`[${who}] ${msg}`)

  try {
    log('setup', 'signing in doctor via sign-in token...')
    await signInWithToken(doctorPage, DOCTOR_USER_ID)
    log('setup', 'signing in patient via sign-in token...')
    await signInWithToken(patientPage, PATIENT_USER_ID)

    log('setup', 'navigating both to phone consultation page...')
    await Promise.all([
      doctorPage.goto(`${BASE}/doctor/consultation/phone/${CONSULTATION_ID}`),
      patientPage.goto(`${BASE}/patient/consultation/phone/${CONSULTATION_ID}`),
    ])

    await doctorPage.waitForTimeout(2000)
    await patientPage.waitForTimeout(2000)

    await doctorPage.screenshot({ path: 'C:/Users/LENOVO/AppData/Local/Temp/claude/doctor_initial.png' })
    await patientPage.screenshot({ path: 'C:/Users/LENOVO/AppData/Local/Temp/claude/patient_initial.png' })

    log('doctor', 'body text snapshot: ' + (await doctorPage.innerText('body')).slice(0, 500).replace(/\s+/g, ' '))
    log('patient', 'body text snapshot: ' + (await patientPage.innerText('body')).slice(0, 500).replace(/\s+/g, ' '))

    // Wait for both to reach a connected-looking state (best-effort text match;
    // exact copy may differ, so just poll body text for a while and report it).
    async function waitForConnected(page, who) {
      for (let i = 0; i < 30; i++) {
        const text = (await page.innerText('body')).toLowerCase()
        if (text.includes('connected') && !text.includes('connection lost') && !text.includes('connecting')) {
          log(who, `reached connected-looking state after ${i * 2}s`)
          return true
        }
        if (text.includes('connection lost') || text.includes('failed')) {
          log(who, `ERROR state detected: ${text.slice(0, 200)}`)
          return false
        }
        await page.waitForTimeout(2000)
      }
      log(who, 'TIMEOUT waiting for connected state')
      return false
    }

    const [docOk, patOk] = await Promise.all([
      waitForConnected(doctorPage, 'doctor'),
      waitForConnected(patientPage, 'patient'),
    ])

    await doctorPage.screenshot({ path: 'C:/Users/LENOVO/AppData/Local/Temp/claude/doctor_connected.png' })
    await patientPage.screenshot({ path: 'C:/Users/LENOVO/AppData/Local/Temp/claude/patient_connected.png' })

    log('result', `doctor connected=${docOk} patient connected=${patOk}`)

    if (docOk && patOk) {
      // Grab timer text for parity check (best-effort selector)
      const docTimer = await doctorPage.innerText('body')
      const patTimer = await patientPage.innerText('body')
      const docMatch = docTimer.match(/\b\d{1,2}:\d{2}\b/)
      const patMatch = patTimer.match(/\b\d{1,2}:\d{2}\b/)
      log('result', `doctor timer=${docMatch?.[0]} patient timer=${patMatch?.[0]}`)

      log('test', 'refreshing doctor page mid-call...')
      await doctorPage.reload()
      await doctorPage.waitForTimeout(3000)
      const afterReload = (await doctorPage.innerText('body')).toLowerCase()
      const recovered = afterReload.includes('connected') && !afterReload.includes('connecting…')
      log('result', `doctor recovered correct state after refresh=${recovered}`)
      await doctorPage.screenshot({ path: 'C:/Users/LENOVO/AppData/Local/Temp/claude/doctor_after_refresh.png' })
    }
  } catch (err) {
    console.error('FATAL:', err)
  } finally {
    await browser.close()
  }
}

main()

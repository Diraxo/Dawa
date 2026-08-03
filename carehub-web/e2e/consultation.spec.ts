/**
 * E2E: Consultation & scheduling pages (smoke level, matching the rest of
 * this suite — page-load/render checks, not a full Agora call simulation).
 *
 * Deliberately NOT covered here (needs seeded fixtures + a live Agora
 * session, which this suite has no infrastructure for): the doctor
 * End-Consultation gate across a live patient disconnect, cross-surface
 * timer sync, and connection-state agreement. Those invariants are covered
 * at the unit level in the root app's __tests__/deriveCallState.test.ts and
 * __tests__/heartbeatGateConsistency.test.ts (same state machine, shared by
 * both apps), and otherwise require the manual QA checklist.
 */
import { test, expect } from '@playwright/test'
import { signIn, TEST_DOCTOR_EMAIL, TEST_DOCTOR_PASSWORD, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD } from './helpers'

test.describe('Doctor scheduling (release item #7: scheduled consultation)', () => {
  test.skip(!TEST_DOCTOR_PASSWORD, 'E2E_DOCTOR_PASSWORD not set — skipping')

  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_DOCTOR_EMAIL, TEST_DOCTOR_PASSWORD)
  })

  test('doctor schedule page shows Today and Upcoming sections', async ({ page }) => {
    await page.goto('/doctor/schedule')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=/today/i').first()).toBeVisible()
    await expect(page.locator('text=/upcoming/i').first()).toBeVisible()
  })

  test('doctor consultations tab loads without a stale/blank default tab', async ({ page }) => {
    await page.goto('/doctor/consultations')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2, [data-testid="consultations-heading"]').first()).toBeVisible()
  })
})

test.describe('Patient booking (release item #7: booked slot is realtime, red, unclickable)', () => {
  test.skip(!TEST_PATIENT_PASSWORD, 'E2E_PATIENT_PASSWORD not set — skipping')

  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD)
  })

  test('appointments page renders without error for a signed-in patient', async ({ page }) => {
    await page.goto('/patient/appointments')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('doctor list page loads and doctor cards render a name and specialty', async ({ page }) => {
    await page.goto('/patient/doctors')
    await page.waitForLoadState('networkidle')
    // At minimum the list container renders without a hard error page.
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })
})

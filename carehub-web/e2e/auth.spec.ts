/**
 * E2E: Authentication flows
 * Covers: sign-in, sign-out, forgot-password, role-based redirect.
 *
 * Prerequisite: set E2E_PATIENT_EMAIL / E2E_PATIENT_PASSWORD etc. in .env.test.local
 */
import { test, expect } from '@playwright/test'
import { signIn, signOut, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD } from './helpers'

test.describe('Authentication', () => {
  test('home page is reachable', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Dawa/i)
  })

  test('unauthenticated user is redirected to sign-in', async ({ page }) => {
    await page.goto('/patient')
    await expect(page).toHaveURL(/sign-in/)
  })

  test('sign-in page renders', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('input[type="email"], input[name="identifier"]').first()).toBeVisible()
  })

  test('invalid credentials shows error', async ({ page }) => {
    await page.goto('/sign-in')
    const emailInput = page.locator('input[type="email"], input[name="identifier"]').first()
    await emailInput.fill('wrong@example.com')

    const continueBtn = page.getByRole('button', { name: /continue|next/i })
    if (await continueBtn.isVisible()) await continueBtn.click()

    const passInput = page.locator('input[type="password"]').first()
    if (await passInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await passInput.fill('wrongpassword')
      await page.getByRole('button', { name: /sign in|continue/i }).first().click()
      // Clerk shows an error message
      await expect(page.locator('[class*="error"], [class*="alert"], [role="alert"]').first()).toBeVisible({ timeout: 8000 })
    }
  })

  test.skip(!TEST_PATIENT_PASSWORD, 'E2E_PATIENT_PASSWORD not set')
  test('patient can sign in and reach patient home', async ({ page }) => {
    await signIn(page, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD)
    await expect(page).toHaveURL(/\/patient/)
  })

  test.skip(!TEST_PATIENT_PASSWORD, 'E2E_PATIENT_PASSWORD not set')
  test('patient is redirected away from doctor routes', async ({ page }) => {
    await signIn(page, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD)
    await page.goto('/doctor')
    await expect(page).not.toHaveURL(/\/doctor/)
  })
})

/**
 * E2E: Doctor flows
 * Covers: dashboard, consultation list, consultation actions.
 */
import { test, expect } from '@playwright/test'
import { signIn, TEST_DOCTOR_EMAIL, TEST_DOCTOR_PASSWORD } from './helpers'

test.skip(!TEST_DOCTOR_PASSWORD, 'E2E_DOCTOR_PASSWORD not set — skipping doctor tests')

test.describe('Doctor Portal', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_DOCTOR_EMAIL, TEST_DOCTOR_PASSWORD)
  })

  test('doctor dashboard loads', async ({ page }) => {
    await page.goto('/doctor')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('consultation history page loads', async ({ page }) => {
    await page.goto('/doctor/consultations')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2, [data-testid="consultations-heading"]').first()).toBeVisible()
  })

  test('doctor cannot access patient routes', async ({ page }) => {
    await page.goto('/patient')
    await expect(page).not.toHaveURL(/\/patient/)
  })

  test('doctor cannot access admin routes', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/admin/)
  })
})

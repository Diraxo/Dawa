/**
 * Shared test helpers for Playwright E2E tests.
 * Set environment variables in .env.test.local (never commit credentials).
 */

import { Page, expect } from '@playwright/test'

export const TEST_PATIENT_EMAIL    = process.env.E2E_PATIENT_EMAIL    ?? 'test.patient@dawa.health'
export const TEST_PATIENT_PASSWORD = process.env.E2E_PATIENT_PASSWORD ?? ''
export const TEST_DOCTOR_EMAIL     = process.env.E2E_DOCTOR_EMAIL     ?? 'test.doctor@dawa.health'
export const TEST_DOCTOR_PASSWORD  = process.env.E2E_DOCTOR_PASSWORD  ?? ''
export const TEST_ADMIN_EMAIL      = process.env.E2E_ADMIN_EMAIL      ?? 'test.admin@dawa.health'
export const TEST_ADMIN_PASSWORD   = process.env.E2E_ADMIN_PASSWORD   ?? ''

/** Sign in via the Dawa sign-in page. */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.waitForLoadState('networkidle')

  // Clerk renders an email field — fill it and submit
  const emailInput = page.locator('input[type="email"], input[name="identifier"]').first()
  await emailInput.fill(email)

  const continueBtn = page.getByRole('button', { name: /continue|next/i })
  if (await continueBtn.isVisible()) await continueBtn.click()

  const passwordInput = page.locator('input[type="password"]').first()
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 })
  await passwordInput.fill(password)

  await page.getByRole('button', { name: /sign in|continue/i }).first().click()
  await page.waitForURL(/\/(patient|doctor|admin|dashboard)/, { timeout: 15_000 })
}

/** Sign out (navigate to sign-in page which Clerk intercepts). */
export async function signOut(page: Page) {
  await page.goto('/sign-in')
}

/** Wait for and dismiss a toast or alert banner matching text. */
export async function expectToast(page: Page, text: string | RegExp) {
  const toast = page.locator('[role="alert"], .toast, [data-toast]').filter({ hasText: text })
  await expect(toast).toBeVisible({ timeout: 8000 })
}

/** Assert a Supabase realtime subscription fires (polls a selector). */
export async function waitForRealtimeUpdate(page: Page, selector: string, text: string | RegExp) {
  await expect(page.locator(selector).filter({ hasText: text })).toBeVisible({ timeout: 15_000 })
}

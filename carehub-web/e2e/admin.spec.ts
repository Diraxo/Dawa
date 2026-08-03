/**
 * E2E: Admin dashboard flows
 * Covers: dashboard, doctors, patients, audit log, settings.
 */
import { test, expect } from '@playwright/test'
import { signIn, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './helpers'

test.skip(!TEST_ADMIN_PASSWORD, 'E2E_ADMIN_PASSWORD not set — skipping admin tests')

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD)
  })

  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1').filter({ hasText: /dashboard|admin/i })).toBeVisible()
  })

  test('doctors page loads with table', async ({ page }) => {
    await page.goto('/admin/doctors')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('table, [role="table"]').first()).toBeVisible()
  })

  test('patients page loads', async ({ page }) => {
    await page.goto('/admin/patients')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('table, [role="table"]').first()).toBeVisible()
  })

  test('audit log page loads with table', async ({ page }) => {
    await page.goto('/admin/audit')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('table').first()).toBeVisible()
  })

  test('audit log search input is present', async ({ page }) => {
    await page.goto('/admin/audit')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('input[placeholder*="Search"]').first()).toBeVisible()
  })

  test('audit log action filter dropdown is present', async ({ page }) => {
    await page.goto('/admin/audit')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('select').first()).toBeVisible()
  })

  test('audit log CSV export button is present', async ({ page }) => {
    await page.goto('/admin/audit')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /export|csv/i })).toBeVisible()
  })

  test('audit log date range filters are present', async ({ page }) => {
    await page.goto('/admin/audit')
    await page.waitForLoadState('networkidle')
    const dateInputs = page.locator('input[type="date"]')
    await expect(dateInputs).toHaveCount(2)
  })

  test('settings page loads', async ({ page }) => {
    await page.goto('/admin/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('specialties page loads', async ({ page }) => {
    await page.goto('/admin/specialties')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('payments/withdrawals page loads', async ({ page }) => {
    await page.goto('/admin/payments')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('admin cannot access patient routes', async ({ page }) => {
    await page.goto('/patient')
    await expect(page).not.toHaveURL(/\/patient/)
  })
})

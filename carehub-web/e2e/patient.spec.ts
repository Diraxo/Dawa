/**
 * E2E: Patient flows
 * Covers: appointments, medical records, file upload validation, messages.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { signIn, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD } from './helpers'

// Skip all tests in this file if credentials are not set
test.skip(!TEST_PATIENT_PASSWORD, 'E2E_PATIENT_PASSWORD not set — skipping patient tests')

test.describe('Patient Portal', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_PATIENT_EMAIL, TEST_PATIENT_PASSWORD)
  })

  test('patient home page renders key sections', async ({ page }) => {
    await page.goto('/patient')
    await page.waitForLoadState('networkidle')
    // Should have at least a heading or booking CTA
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('appointments page loads', async ({ page }) => {
    await page.goto('/patient/appointments')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('messages page loads', async ({ page }) => {
    await page.goto('/patient/messages')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1, h2').first()).toBeVisible()
  })

  test('medical records page loads', async ({ page }) => {
    await page.goto('/patient/medical-records')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1').filter({ hasText: /medical|records/i })).toBeVisible()
  })

  test('file upload rejects executable files', async ({ page }) => {
    await page.goto('/patient/medical-records')
    await page.waitForLoadState('networkidle')

    // Find any file input
    const fileInput = page.locator('input[type="file"]').first()
    if (!(await fileInput.isVisible({ timeout: 3000 }).catch(() => false))) return

    // Try to upload an .exe (should be rejected client-side)
    const fakeExe = Buffer.from('MZ\x90\x00') // PE header magic bytes
    await fileInput.setInputFiles({
      name:     'malware.exe',
      mimeType: 'application/octet-stream',
      buffer:   fakeExe,
    })

    // Expect an error message to appear
    await expect(
      page.locator('text=/not allowed|invalid|unsupported/i').first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('file upload rejects files over 10 MB', async ({ page }) => {
    await page.goto('/patient/medical-records')
    await page.waitForLoadState('networkidle')

    const fileInput = page.locator('input[type="file"]').first()
    if (!(await fileInput.isVisible({ timeout: 3000 }).catch(() => false))) return

    // 11 MB fake PDF
    const oversizedPdf = Buffer.alloc(11 * 1024 * 1024, 0)
    await fileInput.setInputFiles({
      name:     'too-big.pdf',
      mimeType: 'application/pdf',
      buffer:   oversizedPdf,
    })

    await expect(
      page.locator('text=/too large|size|10 MB/i').first()
    ).toBeVisible({ timeout: 5000 })
  })
})

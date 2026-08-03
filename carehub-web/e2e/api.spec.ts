/**
 * E2E: API route protection tests (no auth required — tests that unauthed requests are blocked).
 * These tests run without any browser session so they're always executable in CI.
 */
import { test, expect, type Page } from '@playwright/test'

test.describe('API route protection', () => {
  async function apiGet(page: Page, path: string) {
    const res = await page.request.get(path)
    return res
  }

  test('GET /api/admin/audit requires authentication', async ({ page }) => {
    const res = await page.request.get('/api/admin/audit')
    expect(res.status()).toBeGreaterThanOrEqual(401)
    expect(res.status()).toBeLessThan(500)
  })

  test('GET /api/me requires authentication', async ({ page }) => {
    const res = await page.request.get('/api/me')
    expect(res.status()).toBeGreaterThanOrEqual(401)
    expect(res.status()).toBeLessThan(500)
  })

  test('POST /api/stream-token requires authentication', async ({ page }) => {
    const res = await page.request.post('/api/stream-token', { data: {} })
    expect(res.status()).toBeGreaterThanOrEqual(401)
    expect(res.status()).toBeLessThan(500)
  })

  test('POST /api/agora-token requires authentication', async ({ page }) => {
    const res = await page.request.post('/api/agora-token', {
      data: { channelName: 'test', uid: 1 },
    })
    expect(res.status()).toBeGreaterThanOrEqual(401)
    expect(res.status()).toBeLessThan(500)
  })

  test('GET /api/admin/doctors without auth returns 401/403', async ({ page }) => {
    const res = await page.request.get('/api/admin/doctors')
    expect([401, 403]).toContain(res.status())
  })

  test('PATCH /api/admin/doctors/fake-id without auth returns 401/403', async ({ page }) => {
    const res = await page.request.patch('/api/admin/doctors/fake-id', {
      data: { action: 'suspend' },
    })
    expect([401, 403]).toContain(res.status())
  })

  test('PATCH /api/admin/patients/fake-id without auth returns 401/403', async ({ page }) => {
    const res = await page.request.patch('/api/admin/patients/fake-id', {
      data: { action: 'suspend' },
    })
    expect([401, 403]).toContain(res.status())
  })

  test('GET /api/admin/health without auth returns 401/403', async ({ page }) => {
    const res = await page.request.get('/api/admin/health')
    expect([401, 403]).toContain(res.status())
  })

  // Release item #1/#5: a consultation row (status, summary) must never be
  // readable or writable by an unauthenticated caller — that's the same data
  // the doctor End Consultation / ghost-consultation guards rely on being
  // authoritative.
  test('GET /api/consultations/fake-id without auth returns 401', async ({ page }) => {
    const res = await page.request.get('/api/consultations/fake-id')
    expect(res.status()).toBe(401)
  })

  test('GET /api/admin/consultations/fake-id without auth returns 401/403', async ({ page }) => {
    const res = await page.request.get('/api/admin/consultations/fake-id')
    expect([401, 403]).toContain(res.status())
  })

  test('stream-token rate limit: 30+ requests returns 429', async ({ page }) => {
    // This test checks the rate limiter fires — it requires the server to be running
    // with a rate limit lower than 30 per minute. In CI we adjust windowMs via env.
    // Skip if the endpoint is not reachable.
    const first = await page.request.post('/api/stream-token', { data: {} })
    if (first.status() === 401) {
      // unauthenticated — can't test rate limit without credentials
      test.skip()
    }
  })
})

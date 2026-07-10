import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for carehub-web.
 *
 * Install: cd carehub-web && npm install -D @playwright/test
 * Run:     npx playwright test
 * UI mode: npx playwright test --ui
 * Report:  npx playwright show-report
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace:   'on-first-retry',
    video:   'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to add more browsers in CI
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'Mobile Safari', use: { ...devices['iPhone 14'] } },
  ],

  webServer: process.env.CI
    ? {
        command:           'npm run start',
        url:               'http://localhost:3000',
        reuseExistingServer: true,
        timeout:           120_000,
      }
    : undefined,
})

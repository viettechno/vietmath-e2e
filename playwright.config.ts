import { defineConfig, devices } from '@playwright/test';
import { env } from './support/env';

const CI = !!process.env.CI;

/**
 * Browser end-to-end tests. They run against a whole deployed app: the local
 * stack (scripts/stack-up.sh, the default) or staging (E2E_BASE_URL).
 */
export default defineConfig({
  testDir: 'tests',
  globalSetup: './support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // One retry in CI: a test that passes on retry is reported as flaky, to be fixed.
  retries: CI ? 1 : 0,
  workers: CI ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: env.baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

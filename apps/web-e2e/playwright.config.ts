import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end happy path (PLAN.md Phase 6). Requires the local infrastructure
 * (pnpm infra:up + pnpm db:migrate) and environment variables for the API and
 * worker (see .env.example; AI_PROVIDER=fake). The API and web dev servers
 * start automatically; the ingestion worker starts from global-setup because
 * it exposes no HTTP port for readiness checks.
 */
export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/apps/web-e2e/output',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  globalSetup: './src/global-setup',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm dev:api',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 180_000,
      cwd: '../..',
    },
    {
      command: 'pnpm dev:web',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 180_000,
      cwd: '../..',
    },
  ],
});

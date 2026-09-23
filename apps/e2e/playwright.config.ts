import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests: they drive the real web app against the real API and a real
 * PostgreSQL database. Everything the tests need is started from here, so a single
 * `npm run test:ui` behaves the same on a laptop and in CI.
 */
const CI = Boolean(process.env.CI);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A dedicated database: these tests create devices and punches, so they must never touch
 * the development one. The port follows the repository .env, where a machine with other
 * PostgreSQL instances running can move it out of the way.
 */
function databaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const port = process.env.POSTGRES_PORT ?? readRootEnv().POSTGRES_PORT ?? '5432';
  return `postgresql://asistcontrol:asistcontrol@localhost:${port}/asistcontrol_ui_test?schema=public`;
}

function readRootEnv(): Record<string, string> {
  try {
    const entries = readFileSync(join(ROOT, '.env'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line): [string, string] => [
        line.slice(0, line.indexOf('=')).trim(),
        line.slice(line.indexOf('=') + 1).trim(),
      ]);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // The suite shares one database and one device network: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'es-EC',
    timezoneId: 'America/Guayaquil',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /responsive\.spec\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      // Applies migrations, seeds the demo data and then boots the API.
      command: 'node apps/e2e/support/start-api.mjs',
      cwd: ROOT,
      url: `${API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: !CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        LOG_FORMAT: 'json',
        DATABASE_URL: databaseUrl(),
        CORS_ORIGINS: BASE_URL,
        JWT_ACCESS_SECRET: 'e2e-access-secret-at-least-32-characters-long',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-at-least-32-characters-long',
        DEVICE_SECRETS_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
        // No background polling: every sync in these tests is one the test asked for.
        DEVICE_SYNC_INTERVAL_SECONDS: '0',
        ENABLE_MOCK_DEVICES: 'true',
        APP_TIMEZONE: 'America/Guayaquil',
        // Signing in is limited to 5 attempts a minute, and the suite signs in far more
        // often than a person would. Rate limiting is covered by the API e2e suite.
        THROTTLE_ENABLED: 'false',
      },
    },
    {
      // The production bundle, served the way `vite preview` does, proxying /api to the API.
      command: `npm run preview -w @asistcontrol/web -- --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      cwd: ROOT,
      url: BASE_URL,
      timeout: 120_000,
      reuseExistingServer: !CI,
      env: { VITE_API_PROXY: API_URL },
    },
  ],
});

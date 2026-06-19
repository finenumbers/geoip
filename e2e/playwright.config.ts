import { defineConfig } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT ?? '3000';
const webPort = process.env.E2E_WEB_PORT ?? '4173';
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: webBase,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `pnpm --filter @geoip/api exec tsx src/server.ts`,
      url: `${apiBase}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        API_PORT: apiPort,
        VITE_API_URL: apiBase,
      },
    },
    {
      command: `sh -c 'pnpm --filter @geoip/web build && pnpm --filter @geoip/web exec vite preview --host 127.0.0.1 --port ${webPort}'`,
      url: webBase,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_URL: apiBase,
      },
    },
  ],
});

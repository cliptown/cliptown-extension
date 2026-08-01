import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.mjs',
  // The extension is stateful per profile; a fresh context per test keeps them independent.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {timeout: 15_000},
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : [['list']],
  use: {
    headless: process.env.PLAYWRIGHT_HEADED !== '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

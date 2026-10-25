import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: '../test-results/artifacts',
  reporter: [['list'], ['html', { outputFolder: '../test-results/report', open: 'never' }]],
  use: {
    baseURL: process.env.FUELLOG_WEB_URL ?? 'http://127.0.0.1:8081',
    viewport: { width: 390, height: 844 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

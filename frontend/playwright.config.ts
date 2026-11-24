import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: process.env.CGS_E2E_URL ?? 'http://127.0.0.1:8000',
    channel: 'chrome',
    viewport: { width: 1240, height: 840 },
  },
})

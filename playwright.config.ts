import { defineConfig } from '@playwright/test'

// UI tests. `web` drives the web demo built by vite.e2e.config.ts (the real
// renderer, preload and IPC handlers over in-memory SQLite) in the installed
// Chrome, so there is no browser download. `electron` launches the built
// desktop app on a throwaway profile. Build first: npm run test:e2e /
// npm run test:electron.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'out/test-results',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'out/playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    {
      name: 'web',
      testDir: 'e2e/web',
      use: { channel: 'chrome', baseURL: 'http://localhost:5175/' }
    },
    {
      // the built desktop app; npm run test:electron builds it first
      name: 'electron',
      testDir: 'e2e/electron',
      timeout: 60_000
    }
  ],
  webServer: {
    command: 'npx vite preview -c vite.e2e.config.ts --strictPort',
    url: 'http://localhost:5175/',
    reuseExistingServer: true
  }
})

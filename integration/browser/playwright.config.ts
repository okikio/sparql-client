import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/** Fixture origins are isolated from the OPFS browser owner's ports. */
const origin = 'http://127.0.0.1:4183'

export default defineConfig({
  // Cleanup and artifact recreation stay inside the writable task-owned namespace.
  outputDir: fileURLToPath(new URL('../../.tmp/reports/browser/artifacts', import.meta.url)),
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(Deno.env.get('CI')),
  failOnFlakyTests: true,
  retries: 0,
  workers: 3,
  reporter: [['line'], ['json', {
    outputFile: fileURLToPath(new URL('../../.tmp/reports/browser/results.json', import.meta.url)),
  }]],
  use: { baseURL: origin, trace: 'retain-on-failure' },
  webServer: {
    command:
      'deno run -A npm:vite@8.2.1 --configLoader native --config integration/browser/vite.config.ts --host 127.0.0.1 --port 4183 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `${origin}/integration/browser/index.html`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

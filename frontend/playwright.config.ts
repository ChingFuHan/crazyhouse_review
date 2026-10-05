import { defineConfig, devices } from '@playwright/test'

// Real stack: FastAPI backend + Vite dev server. No mocks.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --host 127.0.0.1 --port 8820',
      cwd: '../backend',
      url: 'http://127.0.0.1:8820/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5180',
      url: 'http://127.0.0.1:5180',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})

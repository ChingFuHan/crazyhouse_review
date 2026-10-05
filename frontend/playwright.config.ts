import { defineConfig, devices } from '@playwright/test'

// Real stack: FastAPI backend + Vite dev server. No mocks.
// Dedicated ports and no server reuse: tests always run against the current code,
// never against a dev server that is still running old code.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5181',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --host 127.0.0.1 --port 8821',
      cwd: '../backend',
      url: 'http://127.0.0.1:8821/api/health',
      reuseExistingServer: false,
      // UI wiring is tested against a deterministic fake LLM that echoes the context it received.
      // Real Claude calls are verified separately (they need ANTHROPIC_API_KEY).
      env: { LLM_PROVIDER: 'fake', REVIEW_MOVETIME_MS: '100' },
      timeout: 60_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5181',
      url: 'http://127.0.0.1:5181',
      reuseExistingServer: false,
      env: { BACKEND_URL: 'http://127.0.0.1:8821' },
      timeout: 60_000,
    },
  ],
})

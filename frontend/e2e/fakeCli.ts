// Fake agy / codex / claude executables for the end-to-end tests (see fake-cli/fake_cli.py).
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('./fake-cli/', import.meta.url))

/** A fresh puzzle database for every test run (the server start clears it). */
export const E2E_DATA_DIR = join(tmpdir(), 'crazyhouse-review-e2e-data')

export const FAKE_CLI_ENV = {
  AGY_PATH: join(dir, 'agy'),
  CODEX_PATH: join(dir, 'codex'),
  CLAUDE_PATH: join(dir, 'claude'),
  FAKE_CLI_STATE: join(tmpdir(), 'crazyhouse-review-fake-cli.json'),
}

import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { activePly, loadPgn } from './helpers'

const games = JSON.parse(
  readFileSync(new URL('../../backend/tests/fixtures/lichess_finished_games.json', import.meta.url), 'utf8'),
) as { pgn: string }[]

test('auto-explain asks only after dwelling on an analysed position, never while browsing', async ({ page }) => {
  test.setTimeout(60_000)
  const asked: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/explain')) asked.push(JSON.parse(r.postData() ?? '{}').position_id)
  })
  await page.goto('/')
  await loadPgn(page, games[1].pgn)
  const ai = page.getByTestId('ai-explain')
  await ai.getByLabel('停留時自動解釋').check()

  // Fast browsing: 15 positions, each left well before analysis + dwell could finish.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(80)
  }
  await activePly(page, 15)
  const here = (await page.locator('.board').getAttribute('data-position-id'))!
  // Dwell: exactly one automatic request, for this position, answered in place.
  await expect(ai.locator('.answer')).toContainText(`position_id=${here}`, { timeout: 15_000 })
  expect(asked).toEqual([here])

  // Coming back to an explained position does not ask again; the preference survives a reload.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await expect(ai.locator('.answer')).toContainText(`position_id=${here}`)
  await page.waitForTimeout(2500)
  expect(asked.filter((id) => id === here)).toHaveLength(1)
  await page.reload()
  await expect(page.getByTestId('ai-explain').getByLabel('停留時自動解釋')).toBeChecked()
})

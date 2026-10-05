import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { activePly, dragMove, loadPgn } from './helpers'

const games = JSON.parse(
  readFileSync(new URL('../../backend/tests/fixtures/lichess_finished_games.json', import.meta.url), 'utf8'),
) as { pgn: string }[]

test('whole-game review annotates main-line moves and lists critical moments', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await loadPgn(page, games[0].pgn) // 83 plies of 1-minute crazyhouse
  const panel = page.getByTestId('review')
  await panel.getByRole('button', { name: '分析主線' }).click()
  await expect(panel.getByTestId('review-progress')).toContainText('/84')
  await expect(panel.getByTestId('review-progress')).toHaveCount(0, { timeout: 90_000 })

  const flagged = page.locator('.move[data-classification]')
  const critical = panel.getByTestId('critical').locator('li')
  const count = await flagged.count()
  expect(count).toBeGreaterThan(0)
  await expect(critical).toHaveCount(count)
  // Only main-line moves are annotated, each with a glyph and an explanation tooltip.
  expect(await page.locator('.move[data-classification]:not(.main)').count()).toBe(0)
  await expect(flagged.first().locator('.glyph')).toHaveText(/^\?\?#|\?#|\?\?|\?!|\?$/)
  await expect(flagged.first()).toHaveAttribute('title', /最佳 \S+ \S+，實戰 \S+（白方視角）/)

  // Clicking a critical moment selects exactly that move.
  const first = critical.first()
  const label = (await first.locator('button').textContent())!
  await first.locator('button').click()
  await expect(page.locator('.move.active')).toHaveAttribute('data-classification', /.+/)
  await expect(page.locator('.move.active')).toContainText(label.replace(/^\d+(\.|…)/, ''))

  // User variations never get review annotations, and the main line keeps its marks.
  await page.keyboard.press('Home')
  await activePly(page, 0)
  await dragMove(page, 'g1', 'f3')
  await activePly(page, 1)
  await expect(page.locator('.move[data-classification]')).toHaveCount(count)
})

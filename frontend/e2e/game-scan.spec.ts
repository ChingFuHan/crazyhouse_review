import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { loadPgn, sideTab } from './helpers'

const games = JSON.parse(
  readFileSync(new URL('../../backend/tests/fixtures/lichess_finished_games.json', import.meta.url), 'utf8'),
) as { pgn: string }[]

test("whole-game scans explain each side's errors from the review, independent of the shown position", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await loadPgn(page, games[2].pgn)
  await sideTab(page, '問 AI')
  const scan = page.getByTestId('game-scan')
  await scan.getByRole('button', { name: '全局掃描：白方 miss 的錯誤' }).click()
  await scan.getByRole('button', { name: '全局掃描：黑方 miss 的錯誤' }).click()
  const white = page.getByTestId('scan-white')
  const black = page.getByTestId('scan-black')
  // The fake LLM echoes the question it got; a side without flagged moves is answered by the rules.
  for (const [result, name] of [[white, '白方'], [black, '黑方']] as const) {
    await expect(result.locator('.answer')).toContainText(
      new RegExp(`question=請根據整局分析，找出${name}|沒有發現${name}的錯誤`),
      { timeout: 90_000 },
    )
  }
  // The scan context is what the model saw: the whole-game task, not the current position.
  const input = white.getByTestId('ai-input')
  if (await input.count()) {
    await input.locator('summary').click()
    await expect(input.locator('pre').last()).toContainText('"task": "game_scan"')
    await expect(input.locator('pre').last()).toContainText('"side": "white"')
  }
  // Browsing the game keeps the scans (they describe the whole main line).
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(white.locator('.answer')).toBeVisible()
  await expect(black.locator('.answer')).toBeVisible()
  // The scan started the whole-game review, so the review panel shows the same analysis.
  await expect(page.getByTestId('review').getByRole('button', { name: '重新分析' })).toBeVisible()
})

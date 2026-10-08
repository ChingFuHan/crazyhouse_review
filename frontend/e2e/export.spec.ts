import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { activePly, dragMove, loadPgn, sideTab } from './helpers'

const GAME = `[Variant "Crazyhouse"]
[White "W"]
[Black "B"]

1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 e6 { a comment } 4. N@d6+ Bxd6 *`

test('export the analysis as PGN and import it back unchanged', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, GAME)
  await page.locator('.move.main', { hasText: /e6$/ }).click()
  await activePly(page, 6)
  await dragMove(page, 'd1', 'h5')
  await activePly(page, 7)
  const ucis = () => page.locator('.move').evaluateAll((els) => els.map((el) => el.getAttribute('data-uci')))
  const before = await ucis()

  await sideTab(page, '對局與工具')
  const panel = page.getByTestId('export')
  await panel.getByRole('button', { name: '匯出 PGN' }).click()
  const pgn = await panel.getByLabel('匯出的 PGN').inputValue()
  expect(pgn).toContain('[Variant "Crazyhouse"]')
  expect(pgn).toContain('[White "W"]')
  expect(pgn).toContain('{ a comment }')
  expect(pgn).toMatch(/\( 4\. Qh5 \)/)

  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: '下載 .pgn' }).click()])
  expect(download.suggestedFilename()).toBe('crazyhouse-review.pgn')
  expect(readFileSync((await download.path())!, 'utf8')).toBe(pgn)

  // Re-import: same moves in the same order; the user line is now an ordinary PGN variation.
  await panel.getByRole('button', { name: '關閉' }).click()
  await loadPgn(page, pgn)
  expect(await ucis()).toEqual(before)
  await expect(page.locator('.variation .move', { hasText: 'Qh5' })).toHaveCount(1)
  await expect(page.locator('.delete-variation')).toHaveCount(0)
})

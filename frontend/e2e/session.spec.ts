import { expect, test } from '@playwright/test'
import { activePly, dragMove, expectBoardConsistent, loadPgn } from './helpers'

const GAME = `[Variant "Crazyhouse"]
[White "W"]
[Black "B"]

1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 e6 { a comment } 4. N@d6+ Bxd6 *`

const moveList = (page: import('@playwright/test').Page) =>
  page.locator('.move').evaluateAll((els) => els.map((el) => `${el.className}|${el.getAttribute('data-uci')}`))

test('a reload restores the game, the user variations and the active position', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, GAME)
  await page.locator('.move.main', { hasText: /e6$/ }).click()
  await activePly(page, 6)
  await dragMove(page, 'd1', 'h5') // user variation 4.Qh5
  await activePly(page, 7)
  await dragMove(page, 'g7', 'g6') // ...g6 inside the variation
  await activePly(page, 8)
  const before = await moveList(page)
  const fen = await expectBoardConsistent(page)

  await page.reload()
  await activePly(page, 8)
  expect(await expectBoardConsistent(page)).toBe(fen)
  expect(await moveList(page)).toEqual(before)
  await expect(page.getByTestId('status')).toContainText('變化')
  await expect(page.locator('.comment')).toHaveText('a comment')
  await expect(page.locator('.players')).toContainText('W – B')
  await page.getByRole('button', { name: '回到主線' }).click()
  await activePly(page, 6)

  // A new game replaces the stored session.
  await page.getByRole('button', { name: '新局面' }).click()
  await activePly(page, 0)
  await page.reload()
  await activePly(page, 0)
  await expect(page.locator('.move')).toHaveCount(0)
})

test('a corrupt stored session falls back to a new game', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('crazyhouse-review:session-source', JSON.stringify({ kind: 'pgn', text: '[Variant "Atomic"]\n\n1. e4 *' }))
    localStorage.setItem('crazyhouse-review:session-state', '{not json')
  })
  await page.reload()
  await activePly(page, 0)
  await expectBoardConsistent(page)
  expect(await page.evaluate(() => localStorage.getItem('crazyhouse-review:session-source'))).toContain('"kind":"fen"')
})

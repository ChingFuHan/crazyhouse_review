import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { expectBoardConsistent, loadPgn } from './helpers'

const games = JSON.parse(
  readFileSync(new URL('../../backend/tests/fixtures/lichess_finished_games.json', import.meta.url), 'utf8'),
) as { id: string; pgn: string }[]

test('every ply of a real lichess game renders the backend position exactly', async ({ page }) => {
  test.setTimeout(120_000)
  const game = games[0] // 83 plies, drops, promotions, mate
  await page.goto('/')
  await loadPgn(page, game.pgn)
  const plies = await page.locator('.move.main').count()
  expect(plies).toBe(83)
  const seen = new Set<string>()
  for (let ply = 1; ply <= plies; ply++) {
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status')).toContainText(`ply ${ply}`)
    seen.add(await expectBoardConsistent(page))
  }
  expect(seen.size).toBe(83)
  await expect(page.getByTestId('status')).toContainText('checkmate')
  // ArrowRight at the end stays put.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('status')).toContainText('ply 83')
  // The move list kept the current move visible inside its scrolling panel.
  const inside = await page.evaluate(() => {
    const panel = document.querySelector('.panel.moves')!.getBoundingClientRect()
    const move = document.querySelector('.move.active')!.getBoundingClientRect()
    return move.top >= panel.top - 1 && move.bottom <= panel.bottom + 1
  })
  expect(inside).toBe(true)
})

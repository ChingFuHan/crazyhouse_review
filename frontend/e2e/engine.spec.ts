import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { activePly, expectBoardConsistent, loadPgn } from './helpers'

const setup = (fen: string) => `[Variant "Crazyhouse"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*`
const games = JSON.parse(
  readFileSync(new URL('../../backend/tests/fixtures/lichess_finished_games.json', import.meta.url), 'utf8'),
) as { pgn: string }[]

test('engine finds a drop mate, shows White-POV mate score and a drop marker', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, setup('6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1'))
  await expect(page.getByTestId('eval-score')).toHaveText('#1')
  await expect(page.getByTestId('best-move')).toHaveText(/^R@[a-e]8#$/)
  await expect(page.locator('.engine-line')).toHaveCount(3)
  // Drop suggestion is drawn as a ghost piece on the target square, not as an arrow.
  await expect(page.locator('cg-auto-pieces piece.rook.white').first()).toBeAttached()

  // Black to move with the mirrored resource: mate score is negative (White POV).
  await loadPgn(page, setup('6k1/5ppp/8/8/8/8/5PPP/6K1[r] b - - 0 1'))
  await expect(page.getByTestId('eval-score')).toHaveText('#-1')
  await expect(page.getByTestId('engine').locator('.eval-owner')).toHaveText('黑方可強制將死')

  // Clicking a PV move plays it as a variation; the mated position is not analysed.
  await page.locator('.engine-line[data-rank="1"] .pv-move').first().click()
  await activePly(page, 1)
  await expect(page.getByTestId('status')).toContainText('checkmate')
  await expect(page.getByTestId('engine')).toContainText('對局已結束')
  await expectBoardConsistent(page)
})

test('engine output always belongs to the active position, even while navigating fast', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await loadPgn(page, games[1].pgn)
  const sameOrEmpty = async () => {
    const [board, engine] = await Promise.all([
      page.locator('.board').getAttribute('data-position-id'),
      page.getByTestId('engine').getAttribute('data-position-id'),
    ])
    expect(engine === '' || engine === board).toBe(true)
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('ArrowRight')
    await sameOrEmpty()
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('ArrowLeft')
    await sameOrEmpty()
  }
  // Settle on a position: analysis arrives for exactly that position and its best move is legal there.
  const boardId = await page.locator('.board').getAttribute('data-position-id')
  await expect(page.getByTestId('engine')).toHaveAttribute('data-position-id', boardId!)
  await expect(page.locator('.engine-meta')).toContainText('depth')
  const best = await page.locator('.engine-line[data-rank="1"] .pv-move').first().getAttribute('data-uci')
  const legal = await page.evaluate(async (id) => {
    const fen = document.querySelector('.board')!.getAttribute('data-fen')!
    const response = await fetch('/api/position', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root_fen: fen, moves: [] }),
    })
    return { id, legal: (await response.json()).legal_moves as string[] }
  }, boardId)
  expect(legal.legal).toContain(best)
})

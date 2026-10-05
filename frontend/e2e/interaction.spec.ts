import { expect, test } from '@playwright/test'
import {
  activePly,
  dragMove,
  expectBoardConsistent,
  fenPieces,
  loadPgn,
  pocketDrop,
  startPocketDrag,
} from './helpers'

const KNIGHT_IN_POCKET = `[Variant "Crazyhouse"]

1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 e6 *`

const setup = (fen: string) => `[Variant "Crazyhouse"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*`

test('fresh game: dragged moves build the main line; illegal drags are refused', async ({ page }) => {
  await page.goto('/')
  await expectBoardConsistent(page)
  await dragMove(page, 'e2', 'e4')
  await activePly(page, 1)
  await dragMove(page, 'e7', 'e5')
  await activePly(page, 2)
  let fen = await expectBoardConsistent(page)
  expect(fen).toContain('4p3/4P3')
  await expect(page.locator('.move.main')).toHaveCount(2)
  await expect(page.getByTestId('status')).not.toContainText('變化')

  // Not a legal destination: chessground snaps back, nothing is sent.
  await dragMove(page, 'd1', 'd5')
  await activePly(page, 2)
  expect(await expectBoardConsistent(page)).toBe(fen)
  // Opponent piece cannot be moved.
  await dragMove(page, 'd7', 'd5')
  await activePly(page, 2)

  // Typed move (SAN) and a typed illegal move with the backend's reason.
  await page.getByLabel('輸入棋步').fill('Nf3')
  await page.getByLabel('輸入棋步').press('Enter')
  await activePly(page, 3)
  await page.getByLabel('輸入棋步').fill('Qxf7')
  await page.getByLabel('輸入棋步').press('Enter')
  await expect(page.getByRole('alert')).toContainText('沒有后能走到 f7')
  await activePly(page, 3)
  fen = await expectBoardConsistent(page)

  // Branch from ply 2 and delete the branch.
  await page.locator('.move', { hasText: /^1…e5$|e5/ }).first().click()
  await activePly(page, 2)
  await dragMove(page, 'f1', 'c4')
  await activePly(page, 3)
  await expect(page.getByTestId('status')).toContainText('變化')
  await page.locator('.delete-variation').click()
  await expect(page.locator('.variation')).toHaveCount(0)
  await expect(page.locator('.move.main')).toHaveCount(3)
})

test('pocket drop with check creates a variation and leaves the PGN main line intact', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, KNIGHT_IN_POCKET)
  await page.keyboard.press('End')
  const mainFen = await expectBoardConsistent(page)
  await expect(page.locator('.pocket[data-color=white] .pocket-slot.usable')).toHaveCount(1)

  const finish = await startPocketDrag(page, 'white', 'N', 'd6')
  // Legal drop squares are highlighted during the drag.
  await expect(page.locator('cg-board square.drop-dest')).not.toHaveCount(0)
  await expect(page.locator('cg-board square.drop-dest')).toHaveCount(
    64 - Object.keys(fenPieces(mainFen)).length,
  )
  await finish()
  await activePly(page, 7)
  await expect(page.locator('.move.active')).toHaveText(/N@d6\+$/)
  const fen = await expectBoardConsistent(page)
  expect(fen).toMatch(/\[p\] b/)
  await expect(page.locator('cg-board square.check')).toHaveCount(1)
  await expect(page.locator('cg-board square.drop-dest')).toHaveCount(0)
  await expect(page.getByTestId('status')).toContainText('變化')

  // Black answers inside the variation, on a flipped board.
  await page.getByRole('button', { name: 'flip' }).click()
  await expect(page.locator('.cg-wrap.orientation-black')).toHaveCount(1)
  await dragMove(page, 'f8', 'd6')
  await activePly(page, 8)
  expect(await expectBoardConsistent(page)).toMatch(/\[np\] w/)
  // White's pocket is empty now.
  await expect(page.locator('.pocket[data-color=white] .pocket-slot.usable')).toHaveCount(0)
  // Black (bottom pocket when flipped) can drop after white moves.
  await dragMove(page, 'g1', 'f3')
  await activePly(page, 9)
  await pocketDrop(page, 'black', 'N', 'g4')
  await activePly(page, 10)
  expect(await expectBoardConsistent(page)).toMatch(/4N1n1\/.*\[p\] w/)
  await page.getByRole('button', { name: 'flip' }).click()

  // Main line untouched; back to main returns to the branch point with the original FEN.
  await expect(page.locator('.move.main')).toHaveCount(6)
  await expect(page.locator('.variation .move')).toHaveCount(4)
  await page.getByRole('button', { name: '回到主線' }).click()
  await activePly(page, 6)
  expect(await expectBoardConsistent(page)).toBe(mainFen)
})

test('illegal pawn drop on the back rank is rejected by the backend and the board rolls back', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, setup('4k3/8/8/8/8/8/8/4K3[P] w - - 0 1'))
  const before = await expectBoardConsistent(page)
  const finish = await startPocketDrag(page, 'white', 'P', 'a8')
  await expect(page.locator('cg-board square.drop-dest')).toHaveCount(48) // ranks 2-7, empty
  await finish()
  await expect(page.getByRole('alert')).toContainText('兵不能打入第 1 或第 8 橫列')
  await activePly(page, 0)
  expect(await expectBoardConsistent(page)).toBe(before)

  await pocketDrop(page, 'white', 'P', 'e7')
  await activePly(page, 1)
  expect(await expectBoardConsistent(page)).toMatch(/4kP2\/8|4k3\/4P3/)
})

test('promotion chooser; a captured promoted piece goes to the pocket as a pawn', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, setup('r3k3/1P6/1n6/8/8/8/8/4K3[] w - - 0 1'))

  // Cancel restores the pawn.
  await dragMove(page, 'b7', 'a8')
  await expect(page.getByRole('dialog', { name: 'promotion' })).toBeVisible()
  await page.locator('.promotion-overlay').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('dialog', { name: 'promotion' })).toHaveCount(0)
  await activePly(page, 0)
  await expectBoardConsistent(page)

  await dragMove(page, 'b7', 'a8')
  await page.getByRole('button', { name: 'promote to knight' }).click()
  await activePly(page, 1)
  let fen = await expectBoardConsistent(page)
  expect(fen.startsWith('N~')).toBe(true)
  expect(fen).toContain('[R]') // captured rook

  await dragMove(page, 'b6', 'a8')
  await activePly(page, 2)
  fen = await expectBoardConsistent(page)
  expect(fen).toContain('[Rp]') // promoted knight returns as a pawn
  await expect(page.locator('.pocket[data-color=black] .pocket-slot[data-role=P]')).toHaveAttribute('data-count', '1')
  await expect(page.locator('.pocket[data-color=black] .pocket-slot[data-role=N]')).toHaveAttribute('data-count', '0')
})

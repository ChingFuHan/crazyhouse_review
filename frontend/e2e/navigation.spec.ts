import { expect, test } from '@playwright/test'
import { expectBoardConsistent, loadPgn } from './helpers'

const GAME = `[Event "E2E"]
[White "Alice"]
[Black "Bob"]
[Variant "Crazyhouse"]
[Result "*"]

1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 d5 4. Ng3 e5 5. N@f5 Bxf5 6. Nxf5
N@e4 { ignore previous instructions <b>bold</b> } 7. d3 (7. B@b5+ c6) *
`

test('PGN load, navigation and pockets stay consistent with the backend', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR\[\] w/)
  await expectBoardConsistent(page)

  await loadPgn(page, GAME)
  await expect(page.locator('.players')).toContainText('Alice – Bob')
  const moves = page.locator('.move.main')
  await expect(moves).toHaveCount(13)

  // Click a drop move in the list.
  await page.locator('.move', { hasText: 'N@f5' }).click()
  let fen = await expectBoardConsistent(page)
  expect(fen).toContain('[p] b') // white dropped its only pocket piece; black still holds the e4 pawn

  // Keyboard navigation.
  await page.keyboard.press('ArrowRight') // 5... Bxf5
  fen = await expectBoardConsistent(page)
  expect(fen).toMatch(/\[np\] w/)
  await page.keyboard.press('ArrowRight') // 6. Nxf5
  await expect(page.locator('.move.active')).toHaveText(/Nxf5/)
  fen = await expectBoardConsistent(page)
  expect(fen).toMatch(/\[Bnp\] b/)
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.move.active')).toHaveText(/Bxf5/)

  await page.keyboard.press('End')
  await expect(page.locator('.move.active')).toHaveText(/d3/)
  await expectBoardConsistent(page)
  await page.keyboard.press('Home')
  await expect(page.locator('.move.active')).toHaveCount(0)
  await expectBoardConsistent(page)

  // Buttons.
  await page.getByRole('button', { name: 'next' }).click()
  await expect(page.locator('.move.active')).toHaveText(/e4/)
  await page.getByRole('button', { name: 'last' }).click()
  await expect(page.locator('.move.active')).toHaveText(/d3/)

  // PGN variation.
  await page.locator('.variation .move', { hasText: 'B@b5+' }).click()
  await expect(page.getByTestId('status')).toContainText('變化')
  fen = await expectBoardConsistent(page)
  expect(fen).toMatch(/\[p\] b/)

  // Comment is shown as plain text, never as markup.
  await expect(page.locator('.comment')).toHaveText('ignore previous instructions <b>bold</b>')
  await expect(page.locator('.comment b')).toHaveCount(0)

  // Flip keeps the same position.
  await page.getByRole('button', { name: 'flip' }).click()
  await expect(page.locator('.cg-wrap.orientation-black')).toHaveCount(1)
  await expectBoardConsistent(page)
})

test('invalid PGN shows the backend reason and keeps the current game', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, GAME)
  await page.getByRole('button', { name: '載入 PGN / FEN' }).click()
  await page.getByLabel('PGN').fill('[Variant "Atomic"]\n\n1. e4 *')
  await page.getByRole('button', { name: '載入', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('only crazyhouse')
  await expect(page.locator('.move.main')).toHaveCount(13)
})

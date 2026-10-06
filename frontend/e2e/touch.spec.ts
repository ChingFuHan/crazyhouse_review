import { expect, test, type Page } from '@playwright/test'
import { activePly, expectBoardConsistent, loadPgn } from './helpers'

test.use({ hasTouch: true, viewport: { width: 420, height: 900 } })

const KNIGHT_IN_POCKET = `[Variant "Crazyhouse"]

1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 e6 *`

async function squarePoint(page: Page, square: string) {
  const box = (await page.locator('cg-board').boundingBox())!
  const size = box.width / 8
  return { x: box.x + ('abcdefgh'.indexOf(square[0]) + 0.5) * size, y: box.y + (8 - Number(square[1]) + 0.5) * size }
}

/** A real touch drag through the Chrome DevTools protocol (touchStart -> touchMove -> touchEnd). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= 8; i++) {
    const point = { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('touch: drag a piece, tap-to-drop from the pocket, drag from the pocket', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, KNIGHT_IN_POCKET)
  await page.keyboard.press('End')
  await activePly(page, 6)
  await page.locator('cg-board').scrollIntoViewIfNeeded()

  // Tap-to-drop: tap the pocket knight, then tap d6.
  const slot = page.locator('.pocket[data-color=white] .pocket-slot[data-role=N]')
  await slot.tap()
  await expect(slot).toHaveAttribute('aria-pressed', 'true')
  const d6 = await squarePoint(page, 'd6')
  const scrolled = await page.evaluate(() => window.scrollY)
  await page.touchscreen.tap(d6.x, d6.y)
  await activePly(page, 7)
  // The move list reveals the new move inside its own panel; the page (and the board) stays put.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
  await expect(page.locator('.move.active')).toHaveText(/N@d6\+$/)
  await expectBoardConsistent(page)

  // Touch drag on the board: Bxd6.
  await touchDrag(page, await squarePoint(page, 'f8'), await squarePoint(page, 'd6'))
  await activePly(page, 8)
  await expect(page.locator('.move.active')).toHaveText(/Bxd6$/)
  expect(await expectBoardConsistent(page)).toMatch(/\[np\] w/)
})

test('touch: drag a pocket piece onto the board', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, KNIGHT_IN_POCKET)
  await page.keyboard.press('End')
  await page.locator('cg-board').scrollIntoViewIfNeeded()
  const slot = (await page.locator('.pocket[data-color=white] .pocket-slot[data-role=N]').boundingBox())!
  await touchDrag(page, { x: slot.x + slot.width / 2, y: slot.y + slot.height / 2 }, await squarePoint(page, 'f6'))
  await activePly(page, 7)
  await expect(page.locator('.move.active')).toHaveText(/N@f6\+$/)
  await expectBoardConsistent(page)
})

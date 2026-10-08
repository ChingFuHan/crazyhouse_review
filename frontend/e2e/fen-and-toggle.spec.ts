import { expect, test } from '@playwright/test'
import { activePly, expectBoardConsistent, loadPgn } from './helpers'

test('a crazyhouse FEN can be loaded directly (both pocket notations)', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, '6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1')
  await activePly(page, 0)
  expect(await expectBoardConsistent(page)).toBe('6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1')
  await expect(page.getByTestId('best-move')).toHaveText(/^R@[a-e]8#$/)

  // lichess style pocket "/R" is normalized to the canonical bracket form.
  await loadPgn(page, '6k1/5ppp/8/8/8/8/5PPP/6K1/R w - - 0 1')
  expect(await expectBoardConsistent(page)).toBe('6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1')

  // An invalid FEN reports the backend's reason and keeps the current position.
  await page.getByRole('button', { name: '載入對局' }).click()
  await page.getByLabel('PGN').fill('8/8/8/8/8/8/8/8[] w - - 0 1')
  await page.getByRole('button', { name: '載入', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('invalid crazyhouse position')
  await page.getByRole('button', { name: '取消' }).click()
  expect(await expectBoardConsistent(page)).toBe('6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1')
})

test('engine can be switched off and on', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, '6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1')
  const engine = page.getByTestId('engine')
  await expect(page.getByTestId('best-move')).toBeVisible()
  await expect(page.locator('cg-auto-pieces piece')).not.toHaveCount(0)

  await engine.getByLabel('Engine 開關').uncheck()
  await expect(engine).toContainText('Engine 已關閉')
  await expect(page.getByTestId('best-move')).toHaveCount(0)
  await expect(page.locator('cg-auto-pieces piece')).toHaveCount(0)
  await expect(page.getByTestId('why')).toContainText('Engine 已關閉')

  // The choice survives a reload (per-viewer preference).
  await page.reload()
  await expect(page.getByTestId('engine')).toContainText('Engine 已關閉')
  await page.getByTestId('engine').getByLabel('Engine 開關').check()
  await expect(page.getByTestId('best-move')).toBeVisible()
})

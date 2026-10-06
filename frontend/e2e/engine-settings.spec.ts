import { type Page, expect, test } from '@playwright/test'
import { loadPgn } from './helpers'

const engine = (page: Page) => page.getByTestId('engine')

async function openSettings(page: Page) {
  await engine(page).getByLabel('Engine 設定').click()
  await expect(page.getByTestId('engine-settings')).toBeVisible()
}

const depthOf = async (page: Page) =>
  Number((await page.getByTestId('engine-progress').textContent())!.match(/depth (\d+)/)![1])

test('lines and depth limit follow the settings, which persist across reloads', async ({ page }) => {
  await page.goto('/')
  await expect(engine(page)).toHaveAttribute('data-status', 'done')
  await expect(page.locator('.engine-line')).toHaveCount(3)
  await openSettings(page)

  await page.getByLabel('線數').selectOption({ label: '1' })
  await expect(engine(page)).toHaveAttribute('data-status', 'done')
  await expect(page.locator('.engine-line')).toHaveCount(1)
  await page.getByLabel('線數').selectOption({ label: '5' })
  await expect(engine(page)).toHaveAttribute('data-status', 'done')
  await expect(page.locator('.engine-line')).toHaveCount(5)

  // A depth limit ends the search long before a generous time limit.
  await page.getByLabel('計算時間').selectOption({ label: '60 秒' })
  await page.getByLabel('深度上限').selectOption({ label: '15' })
  await expect(engine(page)).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  await expect(page.getByTestId('engine-progress')).toContainText('/ 15')
  expect(await depthOf(page)).toBeLessThanOrEqual(15)

  await page.reload()
  await openSettings(page)
  await expect(page.getByLabel('線數')).toHaveValue('4') // index of "5"
  await expect(page.getByLabel('深度上限').locator('option:checked')).toHaveText('15')
  await page.getByText('恢復預設').click()
  await expect(page.getByLabel('計算時間').locator('option:checked')).toHaveText('3 秒')
})

test('infinite analysis deepens, refreshes the facts on the way and stops on request', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, '[Variant "Crazyhouse"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *')
  await openSettings(page)
  await page.getByLabel('計算時間').selectOption({ label: '無限' })
  await expect(engine(page)).toHaveAttribute('data-status', 'analyzing')
  await expect(page.getByTestId('engine-progress')).toContainText('/ 無限')

  // Facts arrive from a depth milestone while the search is still running.
  const why = page.getByTestId('why')
  await expect(why).not.toHaveAttribute('data-analysis-id', '')
  await expect(page.getByTestId('why-source')).toContainText('分析進行中')
  const first = await depthOf(page)
  await expect.poll(() => depthOf(page), { timeout: 20_000 }).toBeGreaterThan(first)
  await expect(engine(page)).toHaveAttribute('data-status', 'analyzing')

  await page.getByTestId('engine-stop').click()
  await expect(engine(page)).toHaveAttribute('data-status', 'done')
  const analysisId = await engine(page).getAttribute('data-analysis-id')
  expect(analysisId).not.toBe('')
  // The fact panel now describes exactly the final, displayed result.
  await expect(why).toHaveAttribute('data-analysis-id', analysisId!)
  await expect(page.getByTestId('why-source')).not.toContainText('分析進行中')
})

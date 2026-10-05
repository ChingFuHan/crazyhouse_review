import { expect, test } from '@playwright/test'
import { activePly, loadPgn } from './helpers'

const setup = (fen: string) => `[Variant "Crazyhouse"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*`

test('why panel explains the engine best move with facts from the same engine result', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, '[Variant "Crazyhouse"]\n\n1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 e6 *')
  await page.keyboard.press('End')
  const why = page.getByTestId('why')
  const engine = page.getByTestId('engine')
  await expect(engine).not.toHaveAttribute('data-analysis-id', '')
  const analysisId = await engine.getAttribute('data-analysis-id')
  await expect(why).toHaveAttribute('data-analysis-id', analysisId!)
  await expect(why).toHaveAttribute('data-position-id', (await page.locator('.board').getAttribute('data-position-id'))!)
  await expect(page.getByTestId('why-best')).toHaveText((await page.getByTestId('best-move').textContent())!)
  await expect(why).toContainText('王的安全')
  await expect(why).toContainText('主要變化')
  await expect(why.locator('.why-compare li')).toHaveCount(2)
  await expect(why).toContainText('對手威脅')
})

test('drop mate explanation and opponent mate threat alert', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, setup('6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1'))
  const why = page.getByTestId('why')
  await expect(page.getByTestId('why-best')).toHaveText(/^R@[a-e]8#$/)
  await expect(why).toContainText('從 pocket 打入車到')
  await expect(why).toContainText('直接將死')
  await expect(why).toContainText('黑方王可走格 2 → 0')
  await expect(why).toContainText('對手沒有合法回應')
  await expect(why.getByTestId('tags')).toContainText('Drop mate')

  // White to move but Black threatens a back-rank drop mate.
  await loadPgn(page, setup('6k1/5ppp/8/8/8/8/5PPP/6K1[r] w - - 0 1'))
  await expect(why.getByTestId('alerts')).toContainText('若不處理，黑方有一步殺')
  // Engine threat analysis (null move) agrees: Black mates at once if White passes.
  await expect(why).toContainText(/對手威脅若不處理，黑方有 R@[a-e]1#，可在 1 步內將死（#-1）。/)

  // After the mate the position is over: the panel describes the last move.
  await loadPgn(page, setup('6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1'))
  await page.getByLabel('輸入棋步').fill('R@e8')
  await page.getByLabel('輸入棋步').press('Enter')
  await activePly(page, 1)
  await expect(why.getByTestId('why-last')).toContainText('R@e8#')
  await expect(why.getByTestId('why-last')).toContainText('直接將死')
})

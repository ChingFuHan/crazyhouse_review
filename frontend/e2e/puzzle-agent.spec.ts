import { type Page, expect, test } from '@playwright/test'
import { pocketDrop } from './helpers'

// The fake CLIs answer the puzzle prompts with JSON (see fake-cli/fake_cli.py): picks with a title
// "假標題 n", and a design that is impossible first (two white kings) and a mate in one after that.
const DESIGNED_FEN = '6k1/5ppp/8/8/8/8/5PPP/6K1[Q] w - - 0 1'

async function chooseCodex(page: Page) {
  await page.goto('/#/puzzles')
  const make = page.getByTestId('puzzle-make')
  // The puzzle page has its own AI choice, separate from the review page's.
  await expect(make.getByTestId('ai-choice')).toHaveText('伺服器預設（fake）')
  await make.getByLabel('AI 設定').click()
  await make.getByLabel('AI 來源').selectOption({ label: 'Codex CLI' })
  await make.getByLabel('Model').selectOption('gpt-6-luna')
  await make.getByLabel('AI 設定').click() // close
  return make
}

/** Open the first puzzle the job made (its link), then sign in: that puzzle is the one shown. */
async function openMade(page: Page, nickname: string) {
  const link = page.getByTestId('made-puzzles').getByRole('link').first()
  const href = await link.getAttribute('href')
  await link.click()
  expect(page.url()).toContain(href!)
  await page.getByLabel('暱稱').fill(nickname)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page.getByTestId('player-rating')).toHaveText('1500')
  await expect(page.getByTestId('puzzle-info').locator('h2')).toContainText(`#${href!.split('/').at(-1)}`)
}

test('the agent designs a position, hears why the engine rejects it, and the puzzle carries its words', async ({ page }) => {
  test.setTimeout(120_000)
  const make = await chooseCodex(page)
  await make.getByText('agent 設計局面').click()
  await make.getByLabel('設計題型').selectOption({ label: '進攻題' })
  await make.getByLabel('題目描述').fill('后打入的將殺')
  await make.getByRole('button', { name: '開始製造' }).click()

  const job = make.getByTestId('puzzle-job')
  await expect(job).toContainText('完成：新增 1 題', { timeout: 60_000 })
  const log = make.getByTestId('puzzle-job-log')
  await expect(log).toContainText('第 1 次設計：6k1/5ppp/8/8/8/8/5PPP/5KK1[Q] w - - 0 1 → 局面不合法：too_many_kings')
  await expect(log).toContainText(`第 2 次設計：${DESIGNED_FEN} → 合格`)
  await expect(log).toContainText('請 codex:gpt-6-luna 依 engine 的解答撰寫標題、提示與說明')
  await expect(make.getByTestId('made-puzzles')).toContainText('進攻題・后的打入')

  await openMade(page, 'e2e-designed')
  await expect(page.getByTestId('puzzle-info').locator('h2')).toContainText('后的打入')
  await expect(page.getByTestId('puzzle-maker')).toHaveText('由 codex:gpt-6-luna 挑選／撰寫')
  // Two-stage hint: the agent's words first, then the piece to move.
  await page.getByRole('button', { name: '提示', exact: true }).click()
  await expect(page.getByTestId('puzzle-hint-text')).toHaveText('提示：黑王還有出路嗎？')
  await expect(page.getByTestId('puzzle-hint')).toHaveCount(0)
  await page.getByRole('button', { name: '再提示' }).click()
  await expect(page.getByTestId('puzzle-hint')).toContainText('從 pocket 打入')
  await pocketDrop(page, 'white', 'Q', 'd8')
  await expect(page.getByTestId('puzzle-feedback')).toContainText('解出來了')
  // The explanation, written from the engine's solution, is shown only once the puzzle is over.
  await expect(page.getByTestId('puzzle-explanation')).toContainText('[FAKE CODEX] 解答 1.Q@')

  // 「下一題」 leaves the link, so a reload gives a new puzzle instead of this one again.
  await page.getByRole('button', { name: '下一題' }).click()
  await expect(page).toHaveURL(/#\/puzzles$/)
})

test('the agent picks among engine candidates and writes their titles', async ({ page }) => {
  test.setTimeout(240_000)
  const make = await chooseCodex(page)
  await make.getByLabel('製造題數').selectOption('3')
  await make.getByRole('button', { name: '開始製造' }).click()
  const job = make.getByTestId('puzzle-job')
  await expect(job).toContainText('製造中（codex:gpt-6-luna）')
  await expect(job).toContainText(/完成：新增 [1-9]\d* 題/, { timeout: 200_000 })
  const log = make.getByTestId('puzzle-job-log')
  await expect(log).toContainText('請 codex:gpt-6-luna 從')
  await expect(log).toContainText(/AI 挑了 \d+ 題/)

  await openMade(page, 'e2e-curated')
  await expect(page.getByTestId('puzzle-info').locator('h2')).toContainText('假標題')
  await expect(page.getByTestId('puzzle-maker')).toHaveText('由 codex:gpt-6-luna 挑選／撰寫')
})

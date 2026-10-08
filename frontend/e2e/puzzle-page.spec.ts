import { type Page, expect, test } from '@playwright/test'
import { dragMove, pocketDrop } from './helpers'

// Puzzles are added through the API (the engine checks each one), so the tests know the answers.
// Each test uses its own positions: other specs add puzzles to the same library.
const BEFORE_MATE = '7k/5ppp/8/8/8/8/5PPP/6K1[R] b - - 0 1' // ...Kg8, then R@d8#
const PLAIN_MATE = '6k1/5ppp/8/8/8/8/5PPP/3K4[R] w - - 0 1'
// Philidor's smothered mate (designed by an agent in a real run): Qg8+ Rxg8 Nf7#.
const SMOTHERED = 'r1bq1r1k/ppp3pp/2n4N/2b1p3/4P3/1Q1P4/PPP2PPP/RNB2RK1[qn] w - - 0 12'

const boardFen = async (page: Page) => (await page.locator('.board').getAttribute('data-fen'))!.split(' ')[0]
const nav = (page: Page, name: 'first' | 'prev' | 'next' | 'last') => page.getByRole('button', { name, exact: true }).click()

async function addPuzzle(page: Page, rootFen: string, moves: string[] = []): Promise<number> {
  const response = await page.request.post('/api/puzzles', { data: { root_fen: rootFen, moves, type: 'attack' } })
  const body = await response.json()
  if (response.ok()) return body.id
  const id = /（#(\d+)）/.exec(body.detail.message)?.[1]
  expect(id, body.detail.message).toBeTruthy()
  return Number(id)
}

async function signIn(page: Page, nickname: string, puzzleId: number) {
  await page.goto(`/#/puzzles/${puzzleId}`)
  await page.getByLabel('暱稱').fill(nickname)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page.getByTestId('player-rating')).toHaveText('1500')
}

test('the opponent’s last move is shown first and stays highlighted', async ({ page }) => {
  const id = await addPuzzle(page, BEFORE_MATE, ['h8g8'])
  await signIn(page, 'e2e-intro', id)
  await expect(page.getByTestId('puzzle-last-move')).toHaveText('對手剛走了 Kg8')
  await expect(page.locator('cg-board square.last-move')).toHaveCount(2)
  await pocketDrop(page, 'white', 'R', 'd8')
  await expect(page.getByTestId('puzzle-feedback')).toHaveText('解出來了！')

  // Solved: the whole puzzle replays, from before the opponent's last move.
  await nav(page, 'first')
  await expect.poll(() => boardFen(page)).toBe(BEFORE_MATE.split(' ')[0])
  await nav(page, 'next')
  await expect.poll(() => boardFen(page)).toBe('6k1/5ppp/8/8/8/8/5PPP/6K1[R]')
  await nav(page, 'next')
  await expect.poll(() => boardFen(page)).toMatch(/^3R2k1\//)
  await expect(page.getByTestId('puzzle-solution').locator('.current')).toHaveText('R@d8#')
  await page.keyboard.press('Home')
  await expect.poll(() => boardFen(page)).toBe('7k/5ppp/8/8/8/8/5PPP/6K1[R]')
  await page.keyboard.press('End')
  await expect.poll(() => boardFen(page)).toMatch(/^3R2k1\//)
})

test('while solving the board moves freely back and forth; a move already found just steps on', async ({ page }) => {
  const id = await addPuzzle(page, SMOTHERED)
  await signIn(page, 'e2e-replay', id)
  const start = await boardFen(page)
  await dragMove(page, 'b3', 'g8')
  await expect(page.getByTestId('puzzle-feedback')).toContainText('正確！對手回應 Rxg8')
  const afterReply = await boardFen(page)
  await nav(page, 'prev')
  await nav(page, 'prev')
  await expect.poll(() => boardFen(page)).toBe(start)
  await nav(page, 'next')
  await nav(page, 'next')
  await expect.poll(() => boardFen(page)).toBe(afterReply)
  await page.keyboard.press('Home')
  await expect.poll(() => boardFen(page)).toBe(start)
  await dragMove(page, 'b3', 'g8') // the same move again: no new judgement, straight past the reply
  await expect.poll(() => boardFen(page)).toBe(afterReply)
  await dragMove(page, 'h6', 'f7')
  await expect(page.getByTestId('puzzle-feedback')).toHaveText('解出來了！')
  await expect(page.getByTestId('puzzle-solution')).toContainText('Qg8+Rxg8Nf7#')
  await nav(page, 'first')
  await expect.poll(() => boardFen(page)).toBe(start)
  await nav(page, 'last')
  await expect(page.getByTestId('puzzle-solution').locator('.current')).toHaveText('Nf7#')
})

test('an agent explains a puzzle once; the next solver gets its hint for half a point; the record and library show it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const id = await addPuzzle(page, PLAIN_MATE)
  // The puzzle page's AI choice (in the library tab) is also the one that explains.
  await page.goto('/#/puzzles/library')
  const make = page.getByTestId('puzzle-make')
  await make.getByLabel('AI 設定').click()
  await make.getByLabel('AI 來源').selectOption({ label: 'Codex CLI' })
  await make.getByLabel('Model').selectOption('gpt-6-luna')

  await signIn(page, 'e2e-explain', id)
  await page.getByRole('button', { name: '看解答' }).click()
  const explain = page.getByTestId('puzzle-explain').getByRole('button')
  await expect(explain).toHaveText('請 AI 解釋這題（Codex CLI · gpt-6-luna）')
  await explain.click()
  await expect(page.getByTestId('puzzle-explanation')).toContainText('[FAKE CODEX] 解答 1.R@', { timeout: 20_000 })
  await expect(page.getByTestId('puzzle-info').locator('h2')).toContainText('假標題 0')

  // Stored for everyone: another player sees the title, gets the agent's hint first, and solving
  // after that hint counts half a point.
  await page.getByRole('button', { name: '登出' }).click()
  await signIn(page, 'e2e-half', id)
  await expect(page.getByTestId('puzzle-maker')).toHaveText('由 codex:gpt-6-luna 挑選／撰寫')
  await page.getByRole('button', { name: '提示', exact: true }).click()
  await expect(page.getByTestId('puzzle-hint-text')).toHaveText('提示：先看清楚雙方王的安全')
  await pocketDrop(page, 'white', 'R', 'd8')
  await expect(page.getByTestId('puzzle-feedback')).toHaveText('解出來了（用了文字提示，算半分）')
  await expect(page.getByTestId('puzzle-explanation')).toContainText('[FAKE CODEX]')

  // A broken puzzle can be reported: it leaves the rotation and the library lists it to restore.
  await page.getByRole('button', { name: '這題有問題？' }).click()
  await page.getByLabel('問題原因').fill('測試回報')
  await page.getByRole('button', { name: '回報並停用' }).click()
  await expect(page).toHaveURL(/#\/puzzles$/)

  await page.getByRole('link', { name: '我的紀錄' }).click()
  const history = page.getByTestId('puzzle-history')
  await expect(history.getByTestId('history-list').locator('li').first()).toContainText(`#${id} 進攻題・假標題 0`)
  await expect(history.getByTestId('history-list').locator('li').first()).toContainText('半分')
  await expect(history.getByTestId('rating-graph').locator('svg')).toBeVisible()
  await expect(history.getByTestId('history-types')).toContainText('進攻題')

  await page.getByRole('link', { name: '題庫與製題' }).click()
  const library = page.getByTestId('puzzle-library')
  await library.getByLabel('被回報的').check()
  const reported = library.getByTestId('library-list').locator('li', { hasText: `#${id} ` })
  await expect(reported).toContainText('e2e-half：測試回報')
  await reported.getByRole('button', { name: '恢復' }).click()
  await expect(reported).toHaveCount(0)
  await library.getByLabel('被回報的').uncheck()
  await library.getByLabel('題型篩選').selectOption({ label: '進攻題' })
  await expect(library.getByTestId('library-list').locator('li', { hasText: `#${id} ` })).toContainText('codex:gpt-6-luna')
  expect(await library.getByTestId('library-list').locator('li').allTextContents()).not.toContainEqual(expect.stringContaining('防守題'))
})

test('on a phone the library and record tabs fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'e2e-phone-tabs', await addPuzzle(page, PLAIN_MATE))
  for (const tab of ['library', 'history']) {
    await page.goto(`/#/puzzles/${tab}`)
    await expect(page.locator('.puzzle-tab-main .panel').first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, tab).toBeLessThanOrEqual(0)
  }
})

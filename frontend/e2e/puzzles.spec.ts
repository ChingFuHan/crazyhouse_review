import { type Page, expect, test } from '@playwright/test'
import { dragMove, loadPgn, pocketDrop } from './helpers'

// Puzzles are added through the API (the engine checks each one), so the tests know the answers.
const MATE_IN_ONE = '6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1'
const BLACK_MATE_IN_ONE = '6k1/5ppp/8/8/8/8/5PPP/6K1[r] b - - 0 1'
// White must take back on c3 with the bishop (found by mining a real game); anything else loses.
const DEFENSE = 'rnbq3r/ppp1kpNp/4pp2/3p4/3Pn3/P1b2N2/2PBPPPP/1R1QKB1R[p] w K - 0 11'
const BALANCED = 'r2q1rk1/ppp1b1pp/2b1P3/3p4/3P4/P1N2p2/1PP2P1P/R1BQR1K1[NNPbnp] w - - 0 14'

/** The puzzle's id; an earlier test may have added it already (the refusal names it). */
async function addPuzzle(page: Page, fen: string, type: string): Promise<number> {
  const response = await page.request.post('/api/puzzles', { data: { root_fen: fen, type } })
  const body = await response.json()
  if (response.ok()) return body.id
  const id = /（#(\d+)）/.exec(body.detail.message)?.[1]
  expect(id, body.detail.message).toBeTruthy()
  return Number(id)
}

/** Sign in on the link to a given puzzle (other specs add puzzles too, so `next` could pick another). */
async function signIn(page: Page, nickname: string, puzzleId: number) {
  await page.goto(`/#/puzzles/${puzzleId}`)
  await page.getByLabel('暱稱').fill(nickname)
  await page.getByRole('button', { name: '登入' }).click()
  await expect(page.getByTestId('player-rating')).toHaveText('1500')
}

test('solve an attack puzzle: rating goes up, the solution and export are offered', async ({ page }) => {
  await signIn(page, 'e2e-attack', await addPuzzle(page, MATE_IN_ONE, 'attack'))
  await expect(page.getByTestId('puzzle-task')).toContainText('白方走：找出致勝的著法（共 1 步）')
  await pocketDrop(page, 'white', 'R', 'c8') // any mating drop is accepted, not only the stored one
  await expect(page.getByTestId('puzzle-feedback')).toContainText('解出來了')
  await expect(page.getByTestId('rating-change')).toContainText('rating 1500 →')
  expect(Number(await page.getByTestId('player-rating').textContent())).toBeGreaterThan(1500)
  await expect(page.getByTestId('puzzle-solution')).toContainText('R@')
  // Themes are named in words, never as codes.
  await expect(page.getByTestId('puzzle-info').locator('.tag').first()).toHaveText('1 步殺')
  expect(await page.getByTestId('puzzle-info').locator('.tag').allTextContents()).not.toContainEqual(expect.stringMatching(/_/))
  const rating = await page.getByTestId('player-rating').textContent()

  // Export: the FEN in lichess form, and the lichess analysis board in a new tab.
  const exportBox = page.getByTestId('puzzle-export')
  await exportBox.getByRole('button', { name: '複製 FEN' }).click()
  await expect(exportBox).toContainText('已複製 FEN')
  const popup = page.waitForEvent('popup')
  await exportBox.getByRole('button', { name: '在 lichess 分析／對戰' }).click()
  expect((await popup).url()).toContain('lichess.org/analysis/crazyhouse/6k1/5ppp/8/8/8/8/5PPP/6K1/R_w_-_-_0_1')

  // Analyse it on the review board: the puzzle position and its solution are loaded there.
  await exportBox.getByRole('button', { name: '在復盤棋盤分析' }).click()
  await expect(page.getByTestId('status')).toContainText(MATE_IN_ONE.split(' ')[0])
  await expect(page.locator('.move.main')).toHaveCount(1)

  // The rating lives on the server: it is still there when the page loads again.
  await page.goto('/#/puzzles')
  await page.reload()
  await expect(page.getByTestId('player-rating')).toHaveText(rating!)
})

test('a wrong move fails the puzzle; the solver may try again (unrated) or see the answer', async ({ page }) => {
  await signIn(page, 'e2e-defense', await addPuzzle(page, DEFENSE, 'defense'))
  await expect(page.getByTestId('puzzle-task')).toContainText('對手有致命威脅，找出唯一能守住的著法')
  await page.getByRole('button', { name: '提示' }).click()
  await expect(page.getByTestId('puzzle-hint')).toContainText('移動 d2 的棋子')
  await dragMove(page, 'a3', 'a4')
  await expect(page.getByTestId('puzzle-feedback')).toContainText('a4 不是答案（已記為失敗）')
  expect(Number(await page.getByTestId('player-rating').textContent())).toBeLessThan(1500)
  // The answer stays hidden: step back (◀ under the board, or ←) and try again, or ask for it.
  await expect(page.getByTestId('puzzle-solution')).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('puzzle-feedback')).toContainText('再試一次（不計分）')
  await expect(page.locator('.board')).toHaveAttribute('data-fen', DEFENSE)
  await dragMove(page, 'd2', 'c3')
  await expect(page.getByTestId('puzzle-feedback')).toContainText('解出來了（重試，不計分）')
  await expect(page.getByTestId('puzzle-solution')).toContainText('Bxc3')
})

test('after a wrong move the answer can be shown', async ({ page }) => {
  await signIn(page, 'e2e-reveal', await addPuzzle(page, DEFENSE, 'defense'))
  await dragMove(page, 'a3', 'a4')
  await page.getByTestId('puzzle-failed-actions').getByRole('button', { name: '看解答' }).click()
  await expect(page.getByTestId('puzzle-solution')).toContainText('Bxc3')
})

test('a battle against the engine is played to the end and rated', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, 'e2e-battle', await addPuzzle(page, BALANCED, 'battle'))
  await expect(page.getByTestId('puzzle-task')).toContainText('與 engine 對下 6 步')
  for (let move = 1; move <= 6; move++) {
    // Play some legal board move from the position on screen (the backend lists them).
    const fen = (await page.locator('.board').getAttribute('data-fen'))!
    const legal = (await (await page.request.post('/api/position', { data: { root_fen: fen, moves: [] } })).json()).legal_moves as string[]
    const uci = legal.find((m) => !m.includes('@'))!
    await dragMove(page, uci.slice(0, 2), uci.slice(2, 4))
    await expect(page.getByTestId('battle-log').locator('li')).toHaveCount(move, { timeout: 20_000 })
    if (await page.getByTestId('battle-result').count()) break
  }
  await expect(page.getByTestId('battle-result')).toContainText(/勝|和|負/)
  await expect(page.getByTestId('rating-change')).toContainText('rating 1500 →')
  // The game against the engine replays from its start.
  const end = await page.locator('.board').getAttribute('data-fen')
  await page.keyboard.press('Home')
  await expect(page.locator('.board')).toHaveAttribute('data-fen', BALANCED)
  await page.keyboard.press('End')
  await expect(page.locator('.board')).toHaveAttribute('data-fen', end!)
})

test('the review board saves the position as a puzzle and mines the game', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, BLACK_MATE_IN_ONE)
  const tools = page.getByTestId('puzzle-tools')
  await tools.getByLabel('題型').selectOption({ label: '進攻題' })
  await tools.getByRole('button', { name: '存成題目' }).click()
  await expect(tools).toContainText(/已存成進攻題 #\d+（1 步/, { timeout: 20_000 })
  await tools.getByRole('button', { name: '存成題目' }).click()
  await expect(tools).toContainText(/已經是一題進攻題（#\d+）/)

  await loadPgn(page, '[Variant "Crazyhouse"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 *')
  await tools.getByRole('button', { name: '從這盤挖題' }).click()
  await expect(page.getByTestId('mine-job')).toContainText('挖題完成', { timeout: 60_000 })
  await page.getByTestId('mine-job').getByRole('link', { name: '到題庫' }).click()
  await expect(page.getByTestId('puzzle-library')).toContainText('共')
  await expect(page.getByTestId('library-list').locator('li').first()).toBeVisible()
})

test('the puzzle page adds a pasted position as a puzzle, checked by the engine', async ({ page }) => {
  await page.goto('/#/puzzles/library')
  const library = page.getByTestId('puzzle-maker-panel')
  // A lichess-style FEN (pocket as a ninth rank) works as well as the bracketed form.
  await library.getByLabel('題目 FEN').fill('5k2/5ppp/8/8/8/8/5PPP/6K1/r b - - 0 1')
  await library.getByLabel('新增的題型').selectOption({ label: '進攻題' })
  await library.getByRole('button', { name: '新增題目' }).click()
  await expect(library.getByTestId('puzzle-added')).toContainText(/已新增進攻題 #\d+（1 步/, { timeout: 20_000 })
  await expect(library.getByTestId('puzzle-added').getByRole('link', { name: '開啟這一題' })).toHaveAttribute('href', /^#\/puzzles\/\d+$/)
  await library.getByLabel('題目 FEN').fill('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1')
  await library.getByRole('button', { name: '新增題目' }).click()
  await expect(library.getByTestId('puzzle-added')).toContainText('不適合當進攻題', { timeout: 20_000 })
})

test('on a phone the puzzle page fits the screen with the board visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'e2e-phone', await addPuzzle(page, MATE_IN_ONE, 'attack'))
  await expect(page.locator('cg-board')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(2) // chessground's file coordinates may stick out by 2 px
})

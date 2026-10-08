import { type Page, expect, test } from '@playwright/test'
import { dragMove, loadPgn, sideTab } from './helpers'

// Black's 3...Nf6?? allows Qxf7#; 3...g6 holds (the engine's choice).
const SCHOLAR = '[Variant "Crazyhouse"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'
const LICHESS_PGN = [
  '[Event "Rated Crazyhouse game"]',
  '[Site "https://lichess.org/abcdEFGH"]',
  '[UTCDate "2026.10.05"]',
  '[White "AliceZ"]',
  '[Black "BobY"]',
  '[Result "0-1"]',
  '[WhiteElo "1850"]',
  '[BlackElo "1912"]',
  '[TimeControl "180+2"]',
  '[Termination "Time forfeit"]',
  '[Variant "Crazyhouse"]',
  '[ECO "C50"]',
  '[Opening "Italian Game"]',
  '',
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 0-1',
].join('\n')
const OTHER_PGN = LICHESS_PGN.replace('abcdEFGH', 'zzzzYYYY').replace('AliceZ', 'Carol').replace('3. Bc4 Bc5', '3. Bb5 a6')

const moveTexts = (page: Page) => page.locator('.move.main').allTextContents()

/** The suite turns the automatic review off (see playwright.config.ts): turn it back on. */
async function autoReview(page: Page) {
  await page.getByTestId('review').getByLabel('自動').check()
}

test('a loaded game is reviewed by itself: summary, filters, next mistake, and learning from it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await autoReview(page)
  await loadPgn(page, SCHOLAR)
  const review = page.getByTestId('review')
  const summary = review.getByTestId('review-summary')
  await expect(summary).toBeVisible({ timeout: 60_000 }) // no button pressed: the review starts by itself
  await expect(summary.locator('tr[data-side=black] td').nth(4)).toHaveText('1') // 殺棋相關: Nf6 allowed mate
  await expect(summary.locator('tr[data-side=black] td').first()).toContainText('%')

  // Only Black's mistakes; n jumps to the next one from the start.
  await review.getByLabel('哪一方的失誤').selectOption('black')
  await expect(review.getByTestId('critical').locator('li')).toHaveCount(1)
  await page.keyboard.press('Home')
  await page.keyboard.press('n')
  await expect(page.locator('.move.active')).toContainText('Nf6')

  // Learn from Black's mistakes: the position before 3...Nf6, tries judged, never added to the game.
  const learn = page.getByTestId('learn')
  await learn.getByRole('button', { name: '練習黑方的失誤：1 題' }).click()
  await expect(learn.getByTestId('learn-item')).toContainText('第 1/1 題：實戰 3…Nf6 是讓對手有強制將殺')
  await expect(page.getByTestId('learn-hidden')).toBeVisible() // engine lines would give it away
  await dragMove(page, 'g8', 'f6')
  await expect(learn.getByTestId('learn-feedback')).toContainText('Nf6 還不夠好（讓對手有強制將殺')
  await dragMove(page, 'g7', 'g6')
  await expect(learn.getByTestId('learn-feedback')).toContainText('好著！g6')
  expect(await page.locator('.move').count()).toBe(7) // nothing was added to the game
  await learn.getByRole('button', { name: '完成' }).click()
  await expect(learn.getByTestId('learn-done')).toContainText('1 題中找到 1 題')
})

test('games come from lichess: a game link, or a player’s latest crazyhouse games; the headers are shown', async ({ page }) => {
  await page.route('https://lichess.org/game/export/**', (route) => {
    const id = route.request().url().split('/export/')[1].split('?')[0]
    return route.fulfill({
      status: id === 'abcdEFGH' || id === 'zzzzYYYY' ? 200 : 404,
      contentType: 'application/x-chess-pgn',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: id === 'zzzzYYYY' ? OTHER_PGN : LICHESS_PGN,
    })
  })
  await page.route('https://lichess.org/api/games/user/**', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: [
        { id: 'abcdEFGH', players: { white: { user: { name: 'AliceZ' }, rating: 1850 }, black: { user: { name: 'BobY' }, rating: 1912 } }, winner: 'black', status: 'outoftime', createdAt: 1, opening: { name: 'Italian Game' }, clock: { initial: 180, increment: 2 } },
        { id: 'zzzzYYYY', players: { white: { user: { name: 'Carol' } }, black: { user: { name: 'BobY' } } }, winner: 'black', status: 'resign', createdAt: 2 },
      ].map((g) => JSON.stringify(g)).join('\n'),
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '載入對局' }).click()
  const loader = page.getByTestId('pgn-loader')
  await loader.getByLabel('lichess 對局網址').fill('https://lichess.org/abcdEFGHxyz1/black')
  await loader.getByRole('button', { name: '載入對局' }).click()
  await expect(page.getByTestId('pgn-loader')).toHaveCount(0)
  await expect(page.locator('.players')).toContainText('AliceZ – BobY 0-1')

  await sideTab(page, '對局與工具')
  const info = page.getByTestId('game-info')
  await expect(info).toContainText('AliceZ（1850）')
  await expect(info).toContainText('0-1（超時）')
  await expect(info).toContainText('3+2')
  await expect(info).toContainText('2026-10-05')
  await expect(info).toContainText('Italian Game（C50）')
  await expect(info.getByRole('link', { name: '在 lichess 開原局' })).toHaveAttribute('href', 'https://lichess.org/abcdEFGH')

  // A player's latest games: pick one.
  await page.getByRole('button', { name: '載入對局' }).click()
  await loader.getByLabel('lichess 使用者').fill('BobY')
  await loader.getByRole('button', { name: '列出最近的 crazyhouse 對局' }).click()
  const games = loader.getByTestId('lichess-games')
  await expect(games.locator('li')).toHaveCount(2)
  await expect(games.locator('li').first()).toContainText('AliceZ（1850） – BobY（1912） 0-1')
  await games.locator('li').nth(1).getByRole('button').click()
  await expect(page.locator('.players')).toContainText('Carol – BobY')
  expect(await moveTexts(page)).toContain('3.Bb5')

  // Both games are among the recent ones; switching back keeps the first one's moves.
  await page.getByRole('button', { name: '載入對局' }).click()
  const recent = loader.getByTestId('recent-games')
  await expect(recent.locator('li')).toHaveCount(2)
  await recent.getByRole('button', { name: /AliceZ – BobY/ }).click()
  await expect(page.locator('.players')).toContainText('AliceZ – BobY')
  expect(await moveTexts(page)).toContain('3.Bc4')
})

test('a variation becomes the main line, for the review, export and after a reload', async ({ page }) => {
  await page.goto('/')
  await loadPgn(page, '[Variant "Crazyhouse"]\n\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *')
  expect(await moveTexts(page)).toEqual(['1.e4', 'e5', '2.Nf3'])
  await page.locator('.variation').getByRole('button', { name: '設為主線' }).click()
  expect(await moveTexts(page)).toEqual(['1.e4', 'c5', '2.Nf3'])
  await expect(page.locator('.variation .move').first()).toHaveText('1…e5')
  await page.reload()
  await expect.poll(() => moveTexts(page)).toEqual(['1.e4', 'c5', '2.Nf3'])
})

test('on a phone the review page fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await autoReview(page)
  await loadPgn(page, SCHOLAR)
  await expect(page.getByTestId('review-summary')).toBeVisible({ timeout: 60_000 })
  for (const tab of ['為什麼', '問 AI', '對局與工具'] as const) {
    await sideTab(page, tab)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, tab).toBeLessThanOrEqual(2)
  }
})

test('the position opens on lichess’s analysis board; the whole game can be imported there', async ({ page, context }) => {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  let posted: string | null = null
  let status = 200
  await context.route('https://lichess.org/api/import', async (route) => {
    posted = new URLSearchParams(route.request().postData() ?? '').get('pgn')
    await route.fulfill(
      status === 200
        ? { json: { id: 'impAbcde', url: 'https://lichess.org/impAbcde' }, headers: cors }
        : { status, body: '{}', headers: cors },
    )
  })
  await context.route('https://lichess.org/impAbcde', (route) => route.fulfill({ contentType: 'text/html', body: '<p>imported</p>' }))
  await page.goto('/')
  await loadPgn(page, SCHOLAR)
  await page.keyboard.press('End')
  const links = page.getByTestId('lichess-links')
  const analysis = links.getByRole('link', { name: '在 lichess 分析這個局面' })
  const fen = (await page.locator('.board').getAttribute('data-fen'))!
  const [board, ...rest] = fen.split(' ')
  const lichessFen = [board.replace(/\[(.*)\]$/, '/$1'), ...rest].join('_')
  await expect(analysis).toHaveAttribute('href', `https://lichess.org/analysis/crazyhouse/${lichessFen}`)
  await page.keyboard.press('f') // seen from Black
  await expect(analysis).toHaveAttribute('href', `https://lichess.org/analysis/crazyhouse/${lichessFen}?color=black`)

  // Importing asks first; cancelling sends nothing.
  await links.getByRole('button', { name: '上傳整盤到 lichess…' }).click()
  await expect(links).toContainText('會在 lichess 建立一盤公開的匯入對局')
  await links.getByRole('button', { name: '取消' }).click()
  expect(posted).toBeNull()

  await links.getByRole('button', { name: '上傳整盤到 lichess…' }).click()
  const popup = page.waitForEvent('popup')
  await links.getByRole('button', { name: '確定上傳' }).click()
  await expect(await popup).toHaveURL('https://lichess.org/impAbcde')
  await expect(links.getByTestId('lichess-imported')).toHaveAttribute('href', 'https://lichess.org/impAbcde')
  expect(posted).toContain('[Variant "Crazyhouse"]')
  expect(posted).toContain('4. Qxf7#')

  status = 429
  await links.getByRole('button', { name: '上傳整盤到 lichess…' }).click()
  await links.getByRole('button', { name: '確定上傳' }).click()
  await expect(links).toContainText('上傳失敗：lichess 請求太頻繁')
})

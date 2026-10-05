import { type Page, expect } from '@playwright/test'

const LETTERS: Record<string, string> = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }

/** Square -> piece letter (uppercase white) from a crazyhouse FEN board part. */
export function fenPieces(fen: string): Record<string, string> {
  const board = fen.split(' ')[0].split('[')[0].replace(/~/g, '')
  const out: Record<string, string> = {}
  board.split('/').forEach((row, r) => {
    let file = 0
    for (const c of row) {
      if (/\d/.test(c)) file += Number(c)
      else {
        out[`${'abcdefgh'[file]}${8 - r}`] = c
        file += 1
      }
    }
  })
  return out
}

export function fenPockets(fen: string): { white: string; black: string } {
  const pocket = fen.match(/\[([^\]]*)\]/)?.[1] ?? ''
  const sort = (s: string) => s.split('').sort().join('')
  return { white: sort(pocket.replace(/[a-z]/g, '').toLowerCase()), black: sort(pocket.replace(/[A-Z]/g, '')) }
}

/** Read the pieces chessground actually rendered, mapped back to squares. */
export async function renderedPieces(page: Page): Promise<Record<string, string>> {
  return page.evaluate((letters) => {
    const board = document.querySelector('cg-board') as HTMLElement
    const size = board.getBoundingClientRect().width / 8
    const black = document.querySelector('.cg-wrap.orientation-black') !== null
    const out: Record<string, string> = {}
    for (const el of Array.from(board.querySelectorAll('piece'))) {
      if (el.classList.contains('ghost') || el.classList.contains('fading')) continue
      const m = (el as HTMLElement).style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
      if (!m) continue
      let file = Math.round(Number(m[1]) / size)
      let rank = 7 - Math.round(Number(m[2]) / size)
      if (black) {
        file = 7 - file
        rank = 7 - rank
      }
      const role = Object.keys(letters).find((r) => el.classList.contains(r))!
      const letter = letters[role]
      out[`${'abcdefgh'[file]}${rank + 1}`] = el.classList.contains('white') ? letter.toUpperCase() : letter
    }
    return out
  }, LETTERS)
}

export async function renderedPockets(page: Page): Promise<{ white: string; black: string }> {
  return page.evaluate(() => {
    const read = (color: string) =>
      Array.from(document.querySelectorAll(`.pocket[data-color=${color}] .pocket-slot`))
        .flatMap((slot) => Array(Number(slot.getAttribute('data-count'))).fill(slot.getAttribute('data-role')!.toLowerCase()))
        .sort()
        .join('')
    return { white: read('white'), black: read('black') }
  })
}

/** UI board and pockets must equal the backend position the board element is bound to. */
export async function expectBoardConsistent(page: Page): Promise<string> {
  const board = page.locator('.board')
  const fen = (await board.getAttribute('data-fen'))!
  await expect.poll(() => renderedPieces(page)).toEqual(fenPieces(fen))
  expect(await renderedPockets(page)).toEqual(fenPockets(fen))
  await expect(page.getByTestId('status')).toContainText(fen)
  return fen
}

export async function loadPgn(page: Page, pgn: string) {
  await page.getByRole('button', { name: '載入 PGN' }).click()
  await page.getByLabel('PGN').fill(pgn)
  await page.getByRole('button', { name: '載入', exact: true }).click()
  await expect(page.getByLabel('PGN')).toHaveCount(0)
}

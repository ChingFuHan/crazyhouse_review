// Games from and to lichess, by the browser (lichess's public API answers any origin, needs no key).

import type { Color } from './types'

export const LICHESS = 'https://lichess.org'
export const USERNAME = /^[A-Za-z0-9_-]{2,30}$/

/** The 8-character game id in a lichess game URL or a bare id (a player's 12-character id, /black,
 * a move anchor or query are allowed and ignored); null when it is not one. */
export function gameIdOf(text: string): string | null {
  const match =
    /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?(?:[?#].*)?$/.exec(text.trim()) ??
    /^([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?$/.exec(text.trim())
  return match ? match[1] : null
}

export interface LichessPlayer {
  name: string
  rating: number | null
}

export interface LichessGame {
  id: string
  white: LichessPlayer
  black: LichessPlayer
  winner: 'white' | 'black' | null
  status: string
  createdAt: number
  opening: string | null
  clock: string | null
}

interface RawPlayer {
  user?: { name?: string }
  aiLevel?: number
  rating?: number
}

const player = (raw: RawPlayer | undefined): LichessPlayer => ({
  name: raw?.user?.name ?? (raw?.aiLevel ? `Stockfish level ${raw.aiLevel}` : '匿名'),
  rating: typeof raw?.rating === 'number' ? raw.rating : null,
})

/** lichess's ndjson game list (one JSON game per line). */
export function parseGames(ndjson: string): LichessGame[] {
  return ndjson
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const raw = JSON.parse(line)
        if (typeof raw.id !== 'string') return []
        return [
          {
            id: raw.id,
            white: player(raw.players?.white),
            black: player(raw.players?.black),
            winner: raw.winner === 'white' || raw.winner === 'black' ? raw.winner : null,
            status: String(raw.status ?? ''),
            createdAt: Number(raw.createdAt ?? 0),
            opening: raw.opening?.name ?? null,
            clock: raw.clock ? `${Math.round(raw.clock.initial / 60)}+${raw.clock.increment}` : null,
          },
        ]
      } catch {
        return []
      }
    })
}

/** lichess's analysis board on a crazyhouse position (pockets written as a ninth rank, as lichess does). */
export function lichessAnalysisUrl(fen: string, orientation: Color): string {
  const [board, ...rest] = fen.trim().split(/\s+/)
  const match = /^(.*)\[(.*)\]$/.exec(board)
  const lichessBoard = match ? `${match[1]}/${match[2]}` : board
  return `${LICHESS}/analysis/crazyhouse/${[lichessBoard, ...rest].join('_')}${orientation === 'black' ? '?color=black' : ''}`
}

async function get(url: string, accept: string, init: RequestInit = {}): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, { ...init, headers: { Accept: accept } })
  } catch {
    throw new Error('無法連到 lichess（請確認網路）')
  }
  if (response.status === 404) throw new Error('lichess 上找不到')
  if (response.status === 429) throw new Error('lichess 請求太頻繁，請等一分鐘再試')
  if (!response.ok) throw new Error(`lichess 回應錯誤（${response.status}）`)
  return response.text()
}

export function fetchGamePgn(id: string): Promise<string> {
  return get(`${LICHESS}/game/export/${id}?clocks=false&evals=false`, 'application/x-chess-pgn')
}

/** Import a PGN as a lichess game (public; lichess keeps the main line only): the game's url. */
export async function importToLichess(pgn: string): Promise<string> {
  const text = await get(`${LICHESS}/api/import`, 'application/json', { method: 'POST', body: new URLSearchParams({ pgn }) })
  const url = (JSON.parse(text) as { url?: unknown }).url
  if (typeof url !== 'string' || !url.startsWith(LICHESS)) throw new Error('lichess 沒有回傳對局網址')
  return url
}

export async function fetchUserGames(username: string): Promise<LichessGame[]> {
  const url = `${LICHESS}/api/games/user/${encodeURIComponent(username)}?max=20&perfType=crazyhouse&opening=true`
  return parseGames(await get(url, 'application/x-ndjson'))
}

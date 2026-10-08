// Restore the review after a reload: only the source (PGN text / FEN) and the user's moves are
// stored; every position is rebuilt by the backend on restore, so nothing chess-related is trusted
// from storage. Per-viewer convenience: storage can be unavailable, so every access is guarded.

import { type GameTree, mainline } from './tree'

export type Source = { kind: 'pgn'; text: string } | { kind: 'fen'; fen: string | null }

export interface StoredSession {
  source: Source
  /** UCI lines (from the root) of user-created nodes, in creation order. */
  userLines: string[][]
  activeMoves: string[]
  /** The main line's last moves, when the viewer promoted another line to be the main line. */
  mainMoves?: string[]
}

/** A game the viewer had open, to switch back to (newest first in the list). */
export interface RecentGame {
  key: string
  label: string
  savedAt: number
  session: StoredSession
}

const SOURCE_KEY = 'crazyhouse-review:session-source'
const STATE_KEY = 'crazyhouse-review:session-state'
const RECENT_KEY = 'crazyhouse-review:recent-games'
export const MAX_RECENT = 10

export function snapshot(tree: GameTree, activeId: string): Omit<StoredSession, 'source'> {
  const userLines = Object.values(tree.nodes)
    .filter((node) => node.origin === 'user' && node.parentId !== null)
    .map((node) => node.state.moves)
  return {
    userLines,
    activeMoves: tree.nodes[activeId]?.state.moves ?? [],
    mainMoves: tree.nodes[mainline(tree).at(-1)!].state.moves,
  }
}

/** One key per game source (the same PGN or FEN is the same game). */
export function sourceKey(source: Source): string {
  const text = source.kind === 'pgn' ? source.text : (source.fen ?? '')
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0
  return `${source.kind}:${text.length}:${hash.toString(36)}`
}

export function recentGames(): RecentGame[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentGame[]
    return Array.isArray(list) ? list.filter((g) => g && typeof g.key === 'string' && g.session?.source) : []
  } catch {
    return []
  }
}

/** Keep `session` first in the recent games (one entry per source, at most MAX_RECENT). */
export function rememberGame(session: StoredSession, label: string, now = Date.now()) {
  const key = sourceKey(session.source)
  const list = [{ key, label, savedAt: now, session }, ...recentGames().filter((g) => g.key !== key)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // best-effort (quota, private mode)
  }
}

export function saveSource(source: Source) {
  try {
    localStorage.setItem(SOURCE_KEY, JSON.stringify(source))
  } catch {
    // best-effort (quota, private mode)
  }
}

export function saveState(state: Omit<StoredSession, 'source'>) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // best-effort
  }
}

const isLine = (value: unknown): value is string[] => Array.isArray(value) && value.every((m) => typeof m === 'string')

export function loadSession(): StoredSession | null {
  try {
    const source = JSON.parse(localStorage.getItem(SOURCE_KEY) ?? 'null') as Source | null
    const state = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as Partial<StoredSession> | null
    if (!source || (source.kind !== 'pgn' && source.kind !== 'fen')) return null
    if (source.kind === 'pgn' && typeof source.text !== 'string') return null
    const userLines = Array.isArray(state?.userLines) ? state.userLines.filter(isLine) : []
    const activeMoves = isLine(state?.activeMoves) ? state.activeMoves : []
    const mainMoves = isLine(state?.mainMoves) ? state.mainMoves : undefined
    return { source, userLines, activeMoves, mainMoves }
  } catch {
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SOURCE_KEY)
    localStorage.removeItem(STATE_KEY)
  } catch {
    // best-effort
  }
}

/** Make the review page open this PGN when it loads next (e.g. to analyse a puzzle there). */
export function openInReview(pgn: string) {
  clearSession()
  saveSource({ kind: 'pgn', text: pgn })
}

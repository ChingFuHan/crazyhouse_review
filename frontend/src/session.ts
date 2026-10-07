// Restore the review after a reload: only the source (PGN text / FEN) and the user's moves are
// stored; every position is rebuilt by the backend on restore, so nothing chess-related is trusted
// from storage. Per-viewer convenience: storage can be unavailable, so every access is guarded.

import type { GameTree } from './tree'

export type Source = { kind: 'pgn'; text: string } | { kind: 'fen'; fen: string | null }

export interface StoredSession {
  source: Source
  /** UCI lines (from the root) of user-created nodes, in creation order. */
  userLines: string[][]
  activeMoves: string[]
}

const SOURCE_KEY = 'crazyhouse-review:session-source'
const STATE_KEY = 'crazyhouse-review:session-state'

export function snapshot(tree: GameTree, activeId: string): Omit<StoredSession, 'source'> {
  const userLines = Object.values(tree.nodes)
    .filter((node) => node.origin === 'user' && node.parentId !== null)
    .map((node) => node.state.moves)
  return { userLines, activeMoves: tree.nodes[activeId]?.state.moves ?? [] }
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
    return { source, userLines, activeMoves }
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

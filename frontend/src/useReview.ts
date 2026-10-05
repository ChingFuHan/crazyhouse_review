// Review session state: the game tree and the active position.
// All positions come from the backend; this hook only routes them into the tree.

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { api } from './api'
import { type Source, type StoredSession, clearSession, loadSession, saveSource, saveState, snapshot } from './session'
import { type GameTree, addChild, deleteSubtree, fromDto, fromRoot, navigation } from './tree'
import type { PositionState } from './types'

export interface ReviewState {
  tree: GameTree | null
  activeId: string | null
  error: string | null
  variantAssumed: boolean
  source: Source | null
}

type Action =
  | { type: 'loaded'; tree: GameTree; variantAssumed: boolean; source: Source; activeId?: string }
  | { type: 'select'; id: string }
  | { type: 'added'; parentId: string; state: PositionState }
  | { type: 'deleted'; id: string }
  | { type: 'error'; message: string | null }

function reducer(s: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case 'loaded':
      return {
        tree: action.tree,
        activeId: action.activeId ?? action.tree.rootId,
        error: null,
        variantAssumed: action.variantAssumed,
        source: action.source,
      }
    case 'select':
      return s.tree?.nodes[action.id] ? { ...s, activeId: action.id } : s
    case 'added': {
      if (!s.tree?.nodes[action.parentId]) return s // tree replaced while the move was in flight
      const { tree, id } = addChild(s.tree, action.parentId, action.state)
      // Only follow the new move if the user is still on the position it was played from.
      return { ...s, tree, error: null, activeId: s.activeId === action.parentId ? id : s.activeId }
    }
    case 'deleted': {
      if (!s.tree) return s
      const node = s.tree.nodes[action.id]
      const tree = deleteSubtree(s.tree, action.id)
      const activeId = s.activeId && tree.nodes[s.activeId] ? s.activeId : (node?.parentId ?? tree.rootId)
      return { ...s, tree, activeId }
    }
    case 'error':
      return { ...s, error: action.message }
  }
}

export type NavKind = keyof typeof navigation

/** One line whose first field has 7 or 8 '/' (8 when the pocket is written lichess-style) and a side to move. */
export function looksLikeFen(text: string): boolean {
  const line = text.trim()
  if (line.includes('\n')) return false
  const [board, side] = line.split(/\s+/)
  const slashes = (board?.match(/\//g) ?? []).length
  return (slashes === 7 || slashes === 8) && (side === 'w' || side === 'b')
}

export function useReview() {
  const [state, dispatch] = useReducer(reducer, {
    tree: null,
    activeId: null,
    error: null,
    variantAssumed: false,
    source: null,
  })

  const fail = (error: unknown) => dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  // Only the most recent game load may replace the tree (an older, slower response is stale).
  const loadGeneration = useRef(0)

  const newGame = useCallback(async (rootFen?: string): Promise<boolean> => {
    const generation = ++loadGeneration.current
    try {
      const root = await api.startPosition(rootFen)
      if (generation !== loadGeneration.current) return false
      dispatch({ type: 'loaded', tree: fromRoot(root), variantAssumed: false, source: { kind: 'fen', fen: rootFen ?? null } })
      return true
    } catch (error) {
      if (generation === loadGeneration.current) fail(error)
      return false
    }
  }, [])

  const loadPgn = useCallback(async (pgn: string): Promise<boolean> => {
    const generation = ++loadGeneration.current
    try {
      const dto = await api.loadPgn(pgn)
      if (generation !== loadGeneration.current) return false
      dispatch({ type: 'loaded', tree: fromDto(dto), variantAssumed: dto.variant_assumed, source: { kind: 'pgn', text: pgn } })
      return true
    } catch (error) {
      if (generation === loadGeneration.current) fail(error)
      return false
    }
  }, [])

  /** Load either a crazyhouse FEN (one line) or a PGN. */
  const loadText = useCallback(
    (text: string): Promise<boolean> => (looksLikeFen(text) ? newGame(text.trim()) : loadPgn(text)),
    [newGame, loadPgn],
  )

  /** Rebuild a stored session through the backend: source first, then the user's moves in order. */
  const restore = useCallback(async (session: StoredSession): Promise<'restored' | 'superseded' | 'failed'> => {
    const generation = ++loadGeneration.current
    try {
      let tree: GameTree
      let variantAssumed = false
      if (session.source.kind === 'pgn') {
        const dto = await api.loadPgn(session.source.text)
        tree = fromDto(dto)
        variantAssumed = dto.variant_assumed
      } else {
        tree = fromRoot(await api.startPosition(session.source.fen ?? undefined))
      }
      const byLine = new Map(Object.values(tree.nodes).map((n) => [n.state.moves.join(' '), n.id]))
      for (const line of session.userLines) {
        const parentId = byLine.get(line.slice(0, -1).join(' '))
        if (!parentId || byLine.has(line.join(' '))) continue
        const child = await api.move(tree.nodes[parentId].state, line[line.length - 1])
        ;({ tree } = addChild(tree, parentId, child))
        byLine.set(child.moves.join(' '), child.position_id)
      }
      if (generation !== loadGeneration.current) return 'superseded'
      const activeId = byLine.get(session.activeMoves.join(' ')) ?? tree.rootId
      dispatch({ type: 'loaded', tree, variantAssumed, source: session.source, activeId })
      return 'restored'
    } catch {
      return generation === loadGeneration.current ? 'failed' : 'superseded'
    }
  }, [])

  const select = useCallback((id: string) => dispatch({ type: 'select', id }), [])

  const play = useCallback(async (from: PositionState, move: string): Promise<PositionState | null> => {
    try {
      const child = await api.move(from, move)
      dispatch({ type: 'added', parentId: from.position_id, state: child })
      return child
    } catch (error) {
      fail(error)
      return null
    }
  }, [])

  /** Play several moves in a row (e.g. an engine line); stops at the first rejected move. */
  const playLine = useCallback(async (from: PositionState, moves: string[]): Promise<PositionState | null> => {
    let current = from
    try {
      for (const move of moves) {
        const child = await api.move(current, move)
        dispatch({ type: 'added', parentId: current.position_id, state: child })
        current = child
      }
      return current
    } catch (error) {
      fail(error)
      return null
    }
  }, [])

  const deleteVariation = useCallback((id: string) => dispatch({ type: 'deleted', id }), [])
  const clearError = useCallback(() => dispatch({ type: 'error', message: null }), [])

  const { tree, activeId } = state
  const navigate = useCallback(
    (kind: NavKind) => {
      if (!tree || !activeId) return
      dispatch({ type: 'select', id: kind === 'first' ? navigation.first(tree) : navigation[kind](tree, activeId) })
    },
    [tree, activeId],
  )

  // Start from the stored session if there is one (a failed restore falls back to a new game).
  useEffect(() => {
    const stored = loadSession()
    void (async () => {
      const outcome = stored ? await restore(stored) : 'failed'
      if (outcome !== 'failed') return // restored, or a newer load (e.g. StrictMode re-mount) took over
      clearSession()
      await newGame()
    })()
  }, [newGame, restore])

  const { source } = state
  useEffect(() => {
    if (source) saveSource(source)
  }, [source])
  useEffect(() => {
    if (tree && activeId) saveState(snapshot(tree, activeId))
  }, [tree, activeId])

  const active = tree && activeId ? tree.nodes[activeId] : null
  return { ...state, active, newGame, loadPgn, loadText, select, play, playLine, navigate, deleteVariation, clearError }
}

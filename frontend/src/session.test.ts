import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECENT, loadSession, recentGames, rememberGame, snapshot, sourceKey } from './session'
import { addChild, fromDto } from './tree'
import type { GameNodeDto, PositionState } from './types'

function state(moves: string[]): PositionState {
  const last = moves.at(-1)
  return {
    position_id: `id:${moves.join(',')}`,
    root_fen: 'root',
    moves,
    ply: moves.length,
    move_number: 1,
    fen: 'f',
    side_to_move: 'white',
    pockets: { white: [], black: [] },
    promoted: [],
    last_move: last ? { uci: last, san: last, from: null, to: 'a1', drop: null, promotion: null, is_capture: false } : null,
    is_check: false,
    outcome: null,
    legal_moves: [],
  }
}
const node = (moves: string[], children: GameNodeDto[] = []): GameNodeDto => ({ state: state(moves), comment: '', children })

describe('session snapshot', () => {
  it('stores only user lines, in creation order, and the active line', () => {
    let tree = fromDto({ headers: {}, variant_assumed: false, root: node([], [node(['e2e4'])]) })
    let id: string
    ;({ tree, id } = addChild(tree, 'id:e2e4', state(['e2e4', 'c7c5'])))
    ;({ tree, id } = addChild(tree, id, state(['e2e4', 'c7c5', 'g1f3'])))
    expect(snapshot(tree, id)).toEqual({
      userLines: [
        ['e2e4', 'c7c5'],
        ['e2e4', 'c7c5', 'g1f3'],
      ],
      activeMoves: ['e2e4', 'c7c5', 'g1f3'],
      mainMoves: ['e2e4'],
    })
  })

  it('loading without storage access is a clean miss', () => {
    expect(loadSession()).toBeNull()
  })
})

describe('recent games', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps one entry per source, newest first, at most MAX_RECENT', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    const session = (text: string) => ({ source: { kind: 'pgn' as const, text }, userLines: [], activeMoves: [] })
    rememberGame(session('1. e4'), 'A', 1)
    rememberGame(session('1. d4'), 'B', 2)
    rememberGame({ ...session('1. e4'), activeMoves: ['e2e4'] }, 'A again', 3)
    expect(recentGames().map((g) => [g.label, g.savedAt])).toEqual([['A again', 3], ['B', 2]])
    expect(recentGames()[0].session.activeMoves).toEqual(['e2e4'])
    for (let i = 0; i < MAX_RECENT + 3; i++) rememberGame(session(`game ${i}`), `G${i}`, 10 + i)
    expect(recentGames()).toHaveLength(MAX_RECENT)
    expect(sourceKey({ kind: 'pgn', text: 'x' })).not.toBe(sourceKey({ kind: 'fen', fen: 'x' }))
  })

  it('without storage there are no recent games and remembering is harmless', () => {
    expect(recentGames()).toEqual([])
    expect(() => rememberGame({ source: { kind: 'fen', fen: null }, userLines: [], activeMoves: [] }, 'x')).not.toThrow()
  })
})

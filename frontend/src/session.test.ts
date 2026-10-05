import { describe, expect, it } from 'vitest'
import { loadSession, snapshot } from './session'
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
    })
  })

  it('loading without storage access is a clean miss', () => {
    expect(loadSession()).toBeNull()
  })
})

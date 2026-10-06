import { describe, expect, it } from 'vitest'
import { exportNodes } from './exportPgn'
import { addChild, fromDto } from './tree'
import type { GameNodeDto, PositionState } from './types'

const state = (moves: string[]): PositionState => ({
  position_id: `id:${moves.join(',')}`,
  root_fen: 'r',
  moves,
  ply: moves.length,
  move_number: 1,
  fen: 'f',
  side_to_move: 'white',
  pockets: { white: [], black: [] },
  promoted: [],
  last_move: moves.length ? { uci: moves.at(-1)!, san: 'x', from: null, to: 'a1', drop: null, promotion: null, is_capture: false } : null,
  is_check: false,
  outcome: null,
  legal_moves: [],
})
const node = (moves: string[], children: GameNodeDto[] = [], comment = ''): GameNodeDto => ({ state: state(moves), comment, children })

describe('exportNodes', () => {
  it('lists parents before children, main continuation first, with comments', () => {
    const tree = fromDto({
      headers: {},
      variant_assumed: false,
      root: node([], [node(['e2e4'], [node(['e2e4', 'e7e5'], [], 'main'), node(['e2e4', 'c7c5'])])], 'start'),
    })
    const { tree: withUser } = addChild(tree, 'id:e2e4,e7e5', state(['e2e4', 'e7e5', 'g1f3']))
    expect(exportNodes(withUser).map((n) => [n.moves.join(' '), n.comment])).toEqual([
      ['', 'start'],
      ['e2e4', ''],
      ['e2e4 e7e5', 'main'],
      ['e2e4 e7e5 g1f3', ''],
      ['e2e4 c7c5', ''],
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { llmMeta } from './llmRequest'
import { addChild, fromDto } from './tree'
import type { GameNodeDto, PositionState } from './types'

const ROOT = 'root-fen'
function state(moves: string[]): PositionState {
  const last = moves.at(-1)
  return {
    position_id: `id:${moves.join(',')}`,
    root_fen: ROOT,
    moves,
    ply: moves.length,
    move_number: Math.floor(moves.length / 2) + 1,
    fen: `fen:${moves.join(',')}`,
    side_to_move: moves.length % 2 ? 'black' : 'white',
    pockets: { white: [], black: [] },
    promoted: [],
    last_move: last ? { uci: last, san: last, from: null, to: last.slice(2, 4), drop: null, promotion: null, is_capture: false } : null,
    is_check: false,
    outcome: null,
    legal_moves: [],
  }
}
const node = (moves: string[], children: GameNodeDto[] = [], comment = ''): GameNodeDto => ({ state: state(moves), comment, children })

const tree = fromDto({
  headers: { White: 'A', Black: 'B' },
  variant_assumed: false,
  root: node([], [node(['e2e4'], [node(['e2e4', 'e7e5'], [node(['e2e4', 'e7e5', 'g1f3'])], 'a comment')])]),
})

describe('llmMeta', () => {
  it('on the main line points at the next game move', () => {
    const meta = llmMeta(tree, 'id:e2e4', 'black')
    expect(meta).toMatchObject({ variation_id: 'main', on_main_line: true, game_move: 'e7e5', game_move_ply: 1, viewer_side: 'black' })
    expect(meta.headers.White).toBe('A')
  })

  it('in a variation points at the game move at the branch point and keeps path comments', () => {
    let { tree: t, id } = addChild(tree, 'id:e2e4,e7e5', state(['e2e4', 'e7e5', 'f1c4']))
    ;({ tree: t, id } = addChild(t, id, state(['e2e4', 'e7e5', 'f1c4', 'b8c6'])))
    const meta = llmMeta(t, id)
    expect(meta.on_main_line).toBe(false)
    expect(meta.variation_id).toBe('v:id:e2e4,e7e5,f1c4')
    expect(meta.game_move).toBe('g1f3')
    expect(meta.game_move_ply).toBe(2)
    expect(meta.comments).toEqual([{ ply: 2, text: 'a comment' }])
  })

  it('at the end of the game there is no game move', () => {
    const meta = llmMeta(tree, 'id:e2e4,e7e5,g1f3')
    expect(meta.game_move).toBeNull()
    expect(meta.game_move_ply).toBeNull()
  })
})

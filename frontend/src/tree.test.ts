import { describe, expect, it } from 'vitest'
import {
  MAIN,
  TreeInvariantError,
  addChild,
  deleteSubtree,
  fromDto,
  mainline,
  mainlineAncestor,
  navigation,
  pathTo,
} from './tree'
import type { GameNodeDto, PositionState } from './types'

const ROOT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1'

// Shape-only stand-ins: the tree never interprets chess, it only checks line consistency.
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
    last_move: last
      ? { uci: last, san: last, from: last.slice(0, 2), to: last.slice(2, 4), drop: null, promotion: null, is_capture: false }
      : null,
    is_check: false,
    outcome: null,
    legal_moves: [],
  }
}

function node(moves: string[], children: GameNodeDto[] = [], comment = ''): GameNodeDto {
  return { state: state(moves), comment, children }
}

// 1. e4 e5 (1... c5 2. Nf3) 2. Nf3
const pgnTree = () =>
  fromDto({
    headers: { Event: 'x' },
    variant_assumed: false,
    root: node([], [
      node(['e2e4'], [
        node(['e2e4', 'e7e5'], [node(['e2e4', 'e7e5', 'g1f3'])]),
        node(['e2e4', 'c7c5'], [node(['e2e4', 'c7c5', 'g1f3'])]),
      ]),
    ]),
  })

describe('fromDto', () => {
  it('assigns main and variation ids', () => {
    const tree = pgnTree()
    expect(mainline(tree).map((id) => tree.nodes[id].variationId)).toEqual([MAIN, MAIN, MAIN, MAIN])
    const side = tree.nodes['id:e2e4,c7c5']
    expect(side.variationId).toBe('v:id:e2e4,c7c5')
    expect(tree.nodes['id:e2e4,c7c5,g1f3'].variationId).toBe(side.variationId)
  })

  it('rejects a child whose line does not extend its parent', () => {
    expect(() =>
      fromDto({ headers: {}, variant_assumed: false, root: node([], [node(['d2d4', 'e7e5'])]) }),
    ).toThrow(TreeInvariantError)
  })
})

describe('addChild', () => {
  it('branches a user variation without touching the main line', () => {
    const tree = pgnTree()
    const before = mainline(tree)
    const { tree: next, id } = addChild(tree, 'id:e2e4,e7e5', state(['e2e4', 'e7e5', 'f1c4']))
    expect(mainline(next)).toEqual(before)
    expect(next.nodes['id:e2e4,e7e5'].children).toEqual(['id:e2e4,e7e5,g1f3', id])
    expect(next.nodes[id].variationId).toBe(`v:${id}`)
    expect(next.nodes[id].origin).toBe('user')
    // original tree object untouched (immutability)
    expect(tree.nodes['id:e2e4,e7e5'].children).toEqual(['id:e2e4,e7e5,g1f3'])
    expect(mainlineAncestor(next, id)).toBe('id:e2e4,e7e5')
  })

  it('reuses an existing child instead of duplicating it', () => {
    const tree = pgnTree()
    const { tree: next, id } = addChild(tree, 'id:e2e4', state(['e2e4', 'e7e5']))
    expect(next).toBe(tree)
    expect(id).toBe('id:e2e4,e7e5')
  })

  it('extends a user variation with the same variation id', () => {
    let { tree, id } = addChild(pgnTree(), 'id:e2e4,e7e5', state(['e2e4', 'e7e5', 'f1c4']))
    const first = id
    ;({ tree, id } = addChild(tree, first, state(['e2e4', 'e7e5', 'f1c4', 'b8c6'])))
    expect(tree.nodes[id].variationId).toBe(tree.nodes[first].variationId)
    expect(pathTo(tree, id)).toEqual(['id:', 'id:e2e4', 'id:e2e4,e7e5', first, id])
  })

  it('a user move after the last PGN move starts a variation, not main line', () => {
    const tree = pgnTree()
    const end = navigation.last(tree, tree.rootId)
    const { tree: next, id } = addChild(tree, end, state(['e2e4', 'e7e5', 'g1f3', 'b8c6']))
    expect(next.nodes[id].variationId).not.toBe(MAIN)
    expect(mainline(next)).toEqual(mainline(tree))
  })

  it('rejects a state that is not a child of the parent', () => {
    expect(() => addChild(pgnTree(), 'id:e2e4', state(['d2d4', 'd7d5']))).toThrow(TreeInvariantError)
  })
})

describe('deleteSubtree', () => {
  it('removes user nodes but never PGN nodes', () => {
    const { tree, id } = addChild(pgnTree(), 'id:e2e4,e7e5', state(['e2e4', 'e7e5', 'f1c4']))
    const pruned = deleteSubtree(tree, id)
    expect(pruned.nodes[id]).toBeUndefined()
    expect(pruned.nodes['id:e2e4,e7e5'].children).toEqual(['id:e2e4,e7e5,g1f3'])
    expect(deleteSubtree(pruned, 'id:e2e4,c7c5')).toBe(pruned)
  })
})

describe('navigation', () => {
  it('moves along the current line', () => {
    const tree = pgnTree()
    expect(navigation.next(tree, tree.rootId)).toBe('id:e2e4')
    expect(navigation.prev(tree, tree.rootId)).toBe(tree.rootId)
    expect(navigation.last(tree, 'id:e2e4,c7c5')).toBe('id:e2e4,c7c5,g1f3')
    expect(navigation.first(tree)).toBe(tree.rootId)
  })
})

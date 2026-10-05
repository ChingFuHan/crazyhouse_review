// UI metadata sent with an LLM question: which variation the user is in, what the game actually
// played, and the PGN comments on the path. The backend re-validates all of it against the line.

import { type GameTree, MAIN, isOnMainline, mainlineAncestor, pathTo } from './tree'
import type { Color } from './types'

export interface LlmMeta {
  variation_id: string
  on_main_line: boolean
  game_move: string | null
  game_move_ply: number | null
  comments: { ply: number; text: string }[]
  headers: Record<string, string>
  /** Side at the bottom of the board: who "my / 我的" most likely refers to. */
  viewer_side: Color | null
}

function mainChild(tree: GameTree, id: string): string | undefined {
  return tree.nodes[id].children.find((c) => tree.nodes[c].variationId === MAIN)
}

export function llmMeta(tree: GameTree, activeId: string, viewerSide: Color | null = null): LlmMeta {
  const node = tree.nodes[activeId]
  const onMain = isOnMainline(tree, activeId)
  // On the main line: the game's next move from here. In a variation: the game's move at the branch.
  const anchorId = onMain ? activeId : mainlineAncestor(tree, activeId)
  const gameChild = mainChild(tree, anchorId)
  return {
    variation_id: node.variationId,
    on_main_line: onMain,
    game_move: gameChild ? tree.nodes[gameChild].state.last_move!.uci : null,
    game_move_ply: gameChild ? tree.nodes[anchorId].state.moves.length : null,
    comments: pathTo(tree, activeId)
      .map((id) => tree.nodes[id])
      .filter((n) => n.comment)
      .map((n) => ({ ply: n.state.ply, text: n.comment })),
    headers: tree.headers,
    viewer_side: viewerSide,
  }
}

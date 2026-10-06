import type { GameTree } from './tree'

export interface ExportNode {
  moves: string[]
  comment: string
}

/** Tree nodes in pre-order with each node's children in display order (main continuation first). */
export function exportNodes(tree: GameTree): ExportNode[] {
  const out: ExportNode[] = []
  const visit = (id: string) => {
    const node = tree.nodes[id]
    out.push({ moves: node.state.moves, comment: node.comment })
    node.children.forEach(visit)
  }
  visit(tree.rootId)
  return out
}

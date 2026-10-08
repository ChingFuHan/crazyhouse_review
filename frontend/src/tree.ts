// Game tree of backend-produced positions. Pure functions, immutable updates.
//
// Invariants (checked by assertChild):
// - node id === state.position_id
// - child.state.moves === parent.state.moves + [child.state.last_move.uci], same root_fen
// - children[0] is the main continuation of a node
// - nodes imported from the PGN are never modified by user moves (only an explicit promotion
//   reorders lines)

import type { GameNodeDto, GameTreeDto, PositionState } from './types'

export const MAIN = 'main'

export interface TreeNode {
  id: string
  state: PositionState
  comment: string
  parentId: string | null
  children: string[]
  /** "main" for the game's main line, otherwise `v:<id of the first node of the variation>`. */
  variationId: string
  origin: 'pgn' | 'user'
}

export interface GameTree {
  rootId: string
  nodes: Record<string, TreeNode>
  headers: Record<string, string>
}

export class TreeInvariantError extends Error {}

function assertChild(parent: PositionState, child: PositionState): void {
  const ok =
    child.root_fen === parent.root_fen &&
    child.last_move !== null &&
    child.moves.length === parent.moves.length + 1 &&
    parent.moves.every((uci, i) => child.moves[i] === uci) &&
    child.moves[child.moves.length - 1] === child.last_move.uci
  if (!ok) {
    throw new TreeInvariantError(`position ${child.position_id} is not a child of ${parent.position_id}`)
  }
}

/** A fresh analysis without a PGN: the first line the user plays becomes the main line. */
export function fromRoot(state: PositionState, headers: Record<string, string> = {}): GameTree {
  const root: TreeNode = {
    id: state.position_id,
    state,
    comment: '',
    parentId: null,
    children: [],
    variationId: MAIN,
    origin: 'user',
  }
  return { rootId: root.id, nodes: { [root.id]: root }, headers }
}

export function fromDto(dto: GameTreeDto): GameTree {
  const nodes: Record<string, TreeNode> = {}
  const visit = (node: GameNodeDto, parentId: string | null, variationId: string) => {
    const id = node.state.position_id
    if (nodes[id]) return // a PGN may repeat the same variation; keep the first
    if (parentId !== null) {
      assertChild(nodes[parentId].state, node.state)
      nodes[parentId].children.push(id)
    }
    nodes[id] = { id, state: node.state, comment: node.comment, parentId, children: [], variationId, origin: 'pgn' }
    node.children.forEach((child, index) =>
      visit(child, id, index === 0 ? variationId : `v:${child.state.position_id}`),
    )
  }
  visit(dto.root, null, MAIN)
  return { rootId: dto.root.state.position_id, nodes, headers: dto.headers }
}

/** Add `state` as a child of `parentId` (or reuse an existing identical child). */
export function addChild(tree: GameTree, parentId: string, state: PositionState): { tree: GameTree; id: string } {
  const parent = tree.nodes[parentId]
  if (!parent) throw new TreeInvariantError(`unknown parent ${parentId}`)
  assertChild(parent.state, state)
  if (parent.children.includes(state.position_id)) return { tree, id: state.position_id }

  // A user line extends its own variation; anything branching off PGN nodes starts a new one.
  const variationId =
    parent.origin === 'user' && parent.children.length === 0 ? parent.variationId : `v:${state.position_id}`
  const node: TreeNode = {
    id: state.position_id,
    state,
    comment: '',
    parentId,
    children: [],
    variationId,
    origin: 'user',
  }
  return {
    id: node.id,
    tree: {
      ...tree,
      nodes: { ...tree.nodes, [parentId]: { ...parent, children: [...parent.children, node.id] }, [node.id]: node },
    },
  }
}

/** Remove a user-created node and its subtree. PGN nodes cannot be deleted. */
export function deleteSubtree(tree: GameTree, id: string): GameTree {
  const node = tree.nodes[id]
  if (!node || node.origin !== 'user' || node.parentId === null) return tree
  const nodes = { ...tree.nodes }
  const drop = (nodeId: string) => {
    nodes[nodeId].children.forEach(drop)
    delete nodes[nodeId]
  }
  drop(id)
  const parent = nodes[node.parentId]
  nodes[parent.id] = { ...parent, children: parent.children.filter((c) => c !== id) }
  return { ...tree, nodes }
}

/** Swap the variation holding `id` with the line it branched from (one level up): its first node
 * becomes the branch point's main continuation and takes that line's id; the old continuation
 * becomes a variation of its own. */
export function promote(tree: GameTree, id: string): GameTree {
  const node = tree.nodes[id]
  if (!node || !node.variationId.startsWith('v:')) return tree
  const variation = node.variationId
  const firstId = variation.slice(2)
  const first = tree.nodes[firstId]
  if (!first || first.parentId === null) return tree
  const branch = tree.nodes[first.parentId]
  const nodes = { ...tree.nodes }
  // Relabel a line: from `start`, following children on the same variation.
  const relabel = (start: string, from: string, to: string) => {
    for (let at: string | undefined = start; at !== undefined && nodes[at].variationId === from; ) {
      const current: TreeNode = nodes[at]
      nodes[at] = { ...current, variationId: to }
      at = current.children.find((c) => nodes[c].variationId === from)
    }
  }
  const oldFirst = branch.children.find((c) => c !== firstId && nodes[c].variationId === branch.variationId)
  if (oldFirst !== undefined) relabel(oldFirst, branch.variationId, `v:${oldFirst}`)
  relabel(firstId, variation, branch.variationId)
  nodes[branch.id] = { ...nodes[branch.id], children: [firstId, ...branch.children.filter((c) => c !== firstId)] }
  return { ...tree, nodes }
}

/** Promote the line through `id` until it is the game's main line. */
export function makeMainline(tree: GameTree, id: string): GameTree {
  let current = tree
  for (let guard = 0; current.nodes[id] && current.nodes[id].variationId !== MAIN && guard < 100; guard++) {
    const next = promote(current, id)
    if (next === current) break
    current = next
  }
  return current
}

export function pathTo(tree: GameTree, id: string): string[] {
  const path: string[] = []
  for (let node: TreeNode | undefined = tree.nodes[id]; node; node = node.parentId ? tree.nodes[node.parentId] : undefined) {
    path.push(node.id)
  }
  return path.reverse()
}

/** The game's main line. User moves never join it, even when they extend its last move. */
export function mainline(tree: GameTree): string[] {
  const line = [tree.rootId]
  for (let node = tree.nodes[tree.rootId]; ; ) {
    const next = node.children.find((c) => tree.nodes[c].variationId === MAIN)
    if (next === undefined) return line
    line.push(next)
    node = tree.nodes[next]
  }
}

/** `id` followed by its main continuation (children[0]) to the end. */
export function continuation(tree: GameTree, id: string): string[] {
  const line = [id]
  for (let node = tree.nodes[id]; node.children.length > 0; node = tree.nodes[node.children[0]]) {
    line.push(node.children[0])
  }
  return line
}

export function isOnMainline(tree: GameTree, id: string): boolean {
  return tree.nodes[id]?.variationId === MAIN
}

/** The deepest main-line node on the path to `id` (where a variation left the game). */
export function mainlineAncestor(tree: GameTree, id: string): string {
  const path = pathTo(tree, id)
  let last = tree.rootId
  for (const nodeId of path) {
    if (!isOnMainline(tree, nodeId)) break
    last = nodeId
  }
  return last
}

export const navigation = {
  first: (tree: GameTree) => tree.rootId,
  prev: (tree: GameTree, id: string) => tree.nodes[id].parentId ?? id,
  next: (tree: GameTree, id: string) => tree.nodes[id].children[0] ?? id,
  last: (tree: GameTree, id: string) => continuation(tree, id).at(-1)!,
}

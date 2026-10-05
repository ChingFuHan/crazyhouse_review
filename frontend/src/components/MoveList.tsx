import { type ReactNode, useEffect, useRef } from 'react'
import { type GameTree, MAIN } from '../tree'

export interface MoveListProps {
  tree: GameTree
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

/** Lichess-style move list: main line with inline (variations). */
export function MoveList({ tree, activeId, onSelect, onDelete }: MoveListProps) {
  const activeRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const moveToken = (id: string, withNumber: boolean): ReactNode => {
    const node = tree.nodes[id]
    const parent = tree.nodes[node.parentId!]
    const white = parent.state.side_to_move === 'white'
    const number = white ? `${parent.state.move_number}.` : withNumber ? `${parent.state.move_number}…` : ''
    const active = id === activeId
    return (
      <span
        key={id}
        ref={active ? activeRef : undefined}
        className={`move${active ? ' active' : ''}${node.variationId === MAIN ? ' main' : ''}`}
        data-node-id={id}
        data-uci={node.state.last_move?.uci}
        onClick={() => onSelect(id)}
      >
        {number && <span className="move-number">{number}</span>}
        {node.state.last_move?.san}
      </span>
    )
  }

  // The continuation of a node is the child on the same variation; every other child is
  // shown as a (variation), including user moves played after the last main-line move.
  const continuationOf = (id: string): string | undefined => {
    const node = tree.nodes[id]
    return node.children.find((c) => tree.nodes[c].variationId === node.variationId)
  }

  const variations = (ids: string[], depth: number): ReactNode[] =>
    ids.map((id) => (
      <span key={`${id}-var`} className={`variation depth-${Math.min(depth, 3)}`}>
        {line(id, depth + 1)}
        {tree.nodes[id].origin === 'user' && (
          <button
            className="delete-variation"
            title="刪除此變化"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(id)
            }}
          >
            ×
          </button>
        )}
      </span>
    ))

  const line = (firstId: string, depth: number): ReactNode[] => {
    const out: ReactNode[] = []
    let needNumber = true
    for (let id: string | undefined = firstId; id !== undefined; ) {
      const node: GameTree['nodes'][string] = tree.nodes[id]
      out.push(moveToken(id, needNumber))
      needNumber = false
      if (node.comment) {
        out.push(
          <span key={`${id}-comment`} className="comment">
            {node.comment}
          </span>,
        )
        needNumber = true
      }
      const parentId = node.parentId!
      if (continuationOf(parentId) === id) {
        const siblings = tree.nodes[parentId].children.filter((c) => c !== id)
        if (siblings.length > 0) {
          out.push(...variations(siblings, depth))
          needNumber = true
        }
      }
      const next = continuationOf(id)
      if (next === undefined && node.children.length > 0) out.push(...variations(node.children, depth))
      id = next
    }
    return out
  }

  const root = tree.nodes[tree.rootId]
  return (
    <div className="move-list" data-testid="move-list">
      {root.comment && <span className="comment">{root.comment}</span>}
      {root.children.length === 0 ? (
        <span className="empty">尚無棋步</span>
      ) : continuationOf(root.id) !== undefined ? (
        line(continuationOf(root.id)!, 0)
      ) : (
        variations(root.children, 0)
      )}
    </div>
  )
}

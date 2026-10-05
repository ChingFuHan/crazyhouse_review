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

  const line = (firstId: string, depth: number): ReactNode[] => {
    const out: ReactNode[] = []
    let needNumber = true
    for (let id: string | undefined = firstId; id !== undefined; id = tree.nodes[id].children[0]) {
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
      const parent = tree.nodes[node.parentId!]
      if (parent.children[0] === id && parent.children.length > 1) {
        for (const sibling of parent.children.slice(1)) {
          out.push(
            <span key={`${sibling}-var`} className={`variation depth-${Math.min(depth, 3)}`}>
              {line(sibling, depth + 1)}
              {tree.nodes[sibling].origin === 'user' && (
                <button
                  className="delete-variation"
                  title="刪除此變化"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(sibling)
                  }}
                >
                  ×
                </button>
              )}
            </span>,
          )
        }
        needNumber = true
      }
    }
    return out
  }

  const root = tree.nodes[tree.rootId]
  return (
    <div className="move-list" data-testid="move-list">
      {root.comment && <span className="comment">{root.comment}</span>}
      {root.children.length === 0 ? <span className="empty">尚無棋步</span> : line(root.children[0], 0)}
    </div>
  )
}

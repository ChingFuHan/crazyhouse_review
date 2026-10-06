import { type ReactNode, useEffect, useRef } from 'react'
import { GLYPH, reviewNote } from '../reviewText'
import { type GameTree, MAIN } from '../tree'
import type { ReviewPly } from '../types'

export interface MoveListProps {
  tree: GameTree
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  /** Whole-game review results keyed by position_id (the position after the move). */
  review?: Map<string, ReviewPly>
}

/** Bring `el` into view inside its own scrolling panel only. scrollIntoView would also scroll the
 * page, which on a phone (single column) moves the board away right after each move. */
function revealInPanel(el: HTMLElement) {
  let panel = el.parentElement
  while (panel && !/(auto|scroll)/.test(getComputedStyle(panel).overflowY)) panel = panel.parentElement
  if (!panel) return
  const box = panel.getBoundingClientRect()
  const item = el.getBoundingClientRect()
  if (item.top < box.top) panel.scrollTop -= box.top - item.top
  else if (item.bottom > box.bottom) panel.scrollTop += item.bottom - box.bottom
}

/** Lichess-style move list: main line with inline (variations). */
export function MoveList({ tree, activeId, onSelect, onDelete, review }: MoveListProps) {
  const activeRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (activeRef.current) revealInPanel(activeRef.current)
  }, [activeId])

  const moveToken = (id: string, withNumber: boolean): ReactNode => {
    const node = tree.nodes[id]
    const parent = tree.nodes[node.parentId!]
    const white = parent.state.side_to_move === 'white'
    const number = white ? `${parent.state.move_number}.` : withNumber ? `${parent.state.move_number}…` : ''
    const active = id === activeId
    const verdict = review?.get(id)
    const classification = verdict?.classification ?? null
    return (
      <span
        key={id}
        ref={active ? activeRef : undefined}
        className={`move${active ? ' active' : ''}${node.variationId === MAIN ? ' main' : ''}${classification ? ` ${classification}` : ''}`}
        data-node-id={id}
        data-uci={node.state.last_move?.uci}
        data-classification={classification ?? undefined}
        title={verdict ? reviewNote(verdict, review?.get(parent.id)) : undefined}
        onClick={() => onSelect(id)}
      >
        {number && <span className="move-number">{number}</span>}
        {node.state.last_move?.san}
        {classification && <span className="glyph">{GLYPH[classification]}</span>}
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

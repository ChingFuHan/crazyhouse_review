import type { Role } from 'chessground/types'
import { useRef } from 'react'
import { PIECE_NAMES } from '../explain'
import { POCKET_ROLES, roleOf } from '../pieces'
import { PieceIcon } from './PieceIcon'
import type { Color } from '../types'

export interface PocketProps {
  color: Color
  pieces: string[]
  /** Whether this side may drop now (its turn and the board is interactive). */
  active: boolean
  onDragStart?: (role: Role, event: React.MouseEvent | React.TouchEvent) => void
  /** Click-to-drop: the piece picked from this pocket, if any. */
  selected?: Role | null
  onSelect?: (role: Role) => void
}

/** A touch that ends within this distance of where it started is a tap. */
const TAP_SLOP_PX = 10
/** Ignore a compatibility click this soon after a tap already toggled the selection. */
const TAP_CLICK_GUARD_MS = 600

/** Crazyhouse pocket: one slot per droppable piece type, with counts. */
export function Pocket({ color, pieces, active, onDragStart, selected, onSelect }: PocketProps) {
  // Chessground cancels the default of touchend, so a tap never becomes a click: detect it here.
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const lastTap = useRef(0)

  return (
    <div className={`pocket cg-wrap pocket-${color}${active ? ' pocket-active' : ''}`} data-color={color}>
      {POCKET_ROLES.map((letter) => {
        const count = pieces.filter((p) => p === letter).length
        const role = roleOf(letter)
        const usable = active && count > 0 && onDragStart !== undefined
        return (
          <div
            key={letter}
            className={`pocket-slot${count === 0 ? ' empty' : ''}${usable ? ' usable' : ''}${selected === role ? ' selected' : ''}`}
            data-role={letter}
            data-count={count}
            title={`${color} ${role} × ${count}`}
            role="button"
            tabIndex={usable ? 0 : -1}
            aria-label={`${color === 'white' ? '白方' : '黑方'} pocket：${PIECE_NAMES[letter]} × ${count}`}
            aria-disabled={!usable}
            onKeyDown={
              usable && onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(role)
                    }
                  }
                : undefined
            }
            onMouseDown={usable ? (e) => onDragStart(role, e) : undefined}
            onTouchStart={
              usable
                ? (e) => {
                    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
                    onDragStart(role, e)
                  }
                : undefined
            }
            onTouchEnd={
              usable && onSelect
                ? (e) => {
                    const start = touchStart.current
                    const end = e.changedTouches[0]
                    touchStart.current = null
                    if (start && Math.hypot(end.clientX - start.x, end.clientY - start.y) < TAP_SLOP_PX) {
                      lastTap.current = Date.now()
                      onSelect(role)
                    }
                  }
                : undefined
            }
            onClick={
              usable && onSelect
                ? () => {
                    if (Date.now() - lastTap.current > TAP_CLICK_GUARD_MS) onSelect(role)
                  }
                : undefined
            }
            aria-pressed={selected === role}
          >
            <PieceIcon role={role} color={color} />
            {count > 1 && <span className="pocket-count">{count}</span>}
          </div>
        )
      })}
    </div>
  )
}

import type { Role } from 'chessground/types'
import { POCKET_ROLES, roleOf } from '../pieces'
import { PieceIcon } from './PieceIcon'
import type { Color } from '../types'

export interface PocketProps {
  color: Color
  pieces: string[]
  /** Whether this side may drop now (its turn and the board is interactive). */
  active: boolean
  onDragStart?: (role: Role, event: React.MouseEvent | React.TouchEvent) => void
}

/** Crazyhouse pocket: one slot per droppable piece type, with counts. */
export function Pocket({ color, pieces, active, onDragStart }: PocketProps) {
  return (
    <div className={`pocket cg-wrap pocket-${color}${active ? ' pocket-active' : ''}`} data-color={color}>
      {POCKET_ROLES.map((letter) => {
        const count = pieces.filter((p) => p === letter).length
        const role = roleOf(letter)
        const usable = active && count > 0 && onDragStart !== undefined
        return (
          <div
            key={letter}
            className={`pocket-slot${count === 0 ? ' empty' : ''}${usable ? ' usable' : ''}`}
            data-role={letter}
            data-count={count}
            title={`${color} ${role} × ${count}`}
            onMouseDown={usable ? (e) => onDragStart(role, e) : undefined}
            onTouchStart={usable ? (e) => onDragStart(role, e) : undefined}
          >
            <PieceIcon role={role} color={color} />
            {count > 1 && <span className="pocket-count">{count}</span>}
          </div>
        )
      })}
    </div>
  )
}

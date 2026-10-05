import type { Role } from 'chessground/types'
import { useLayoutEffect, useRef } from 'react'
import type { Color } from '../types'

/** A chessground <piece> sprite (created via DOM: React does not know the tag). */
export function PieceIcon({ role, color }: { role: Role; color: Color }) {
  const host = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const piece = document.createElement('piece')
    piece.className = `${role} ${color}`
    host.current?.replaceChildren(piece)
  }, [role, color])
  return <span ref={host} className="piece-icon" />
}

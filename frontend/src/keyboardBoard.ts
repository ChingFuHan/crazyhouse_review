// Keyboard cursor over the board. Directions are as the user sees the board (orientation-aware).

import type { Key } from 'chessground/types'
import type { Color } from './types'

const FILES = 'abcdefgh'

export type Direction = 'up' | 'down' | 'left' | 'right'

export function moveCursor(cursor: Key, direction: Direction, orientation: Color): Key {
  let file = FILES.indexOf(cursor[0])
  let rank = Number(cursor[1]) - 1
  const sign = orientation === 'white' ? 1 : -1
  if (direction === 'up') rank += sign
  if (direction === 'down') rank -= sign
  if (direction === 'right') file += sign
  if (direction === 'left') file -= sign
  file = Math.min(7, Math.max(0, file))
  rank = Math.min(7, Math.max(0, rank))
  return `${FILES[file]}${rank + 1}` as Key
}

/** Where the cursor starts: the e-file pawn square of the side at the bottom. */
export function initialCursor(orientation: Color): Key {
  return orientation === 'white' ? 'e2' : 'e7'
}

export const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

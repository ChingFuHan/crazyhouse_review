import type { Role } from 'chessground/types'

const ROLES: Record<string, Role> = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }
const LETTERS: Record<Role, string> = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' }

export const POCKET_ROLES = ['Q', 'R', 'B', 'N', 'P'] as const

export function roleOf(letter: string): Role {
  const role = ROLES[letter.toUpperCase()]
  if (!role) throw new Error(`unknown piece letter ${letter}`)
  return role
}

export function letterOf(role: Role): string {
  return LETTERS[role]
}

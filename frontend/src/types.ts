// Mirrors backend/app/models.py. The backend is the only rules authority:
// these objects are produced there and never computed in the browser.

export type Color = 'white' | 'black'

export interface MoveModel {
  uci: string
  san: string
  from: string | null
  to: string
  drop: string | null
  promotion: string | null
  is_capture: boolean
}

export interface Pockets {
  white: string[]
  black: string[]
}

export interface Outcome {
  result: string
  termination: string
  winner: Color | null
}

export interface PositionState {
  position_id: string
  root_fen: string
  moves: string[]
  ply: number
  move_number: number
  fen: string
  side_to_move: Color
  pockets: Pockets
  promoted: string[]
  last_move: MoveModel | null
  is_check: boolean
  outcome: Outcome | null
  legal_moves: string[]
}

export interface GameNodeDto {
  state: PositionState
  comment: string
  children: GameNodeDto[]
}

export interface GameTreeDto {
  headers: Record<string, string>
  variant_assumed: boolean
  root: GameNodeDto
}

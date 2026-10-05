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

export interface EngineLine {
  rank: number
  /** Pawns from White's point of view; null when the line is a forced mate. */
  evaluation: number | null
  /** Moves to mate from White's point of view: positive = White mates. */
  mate: number | null
  evaluation_pov: 'white'
  depth: number
  pv: MoveModel[]
}

export interface EngineAnalysis {
  position_id: string
  status: 'ok' | 'cancelled' | 'game_over'
  engine: string
  multipv: number
  movetime_ms: number
  depth: number
  lines: EngineLine[]
  best_move: MoveModel | null
  analysis_id: string
  cached: boolean
}

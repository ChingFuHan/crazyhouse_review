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

export interface PieceOnSquare {
  square: string
  piece: string
  color: Color
}

export interface SideFacts {
  color: Color
  king_square: string | null
  king_escape_squares: string[]
  king_zone_attacks: number
  pocket: string[]
  hanging_pieces: PieceOnSquare[]
  attacked_queens_rooks: PieceOnSquare[]
  drop_check_squares: Record<string, string[]>
}

export interface PositionFacts {
  side_to_move: Color
  in_check: boolean
  checkers: PieceOnSquare[]
  legal_move_count: number
  mate_in_one: string[]
  opponent_mate_threats: string[]
  white: SideFacts
  black: SideFacts
}

export interface MoveFacts {
  move: MoveModel
  mover: Color
  is_check: boolean
  is_mate: boolean
  is_capture: boolean
  captured: string | null
  is_drop: boolean
  is_promotion: boolean
  discovered_check: boolean
  attacks: PieceOnSquare[]
  opponent_king_escape_before: string[]
  opponent_king_escape_after: string[]
  pocket_before: string[]
  pocket_after: string[]
  opponent_reply_count: number
  forced_replies: string[]
  tags: string[]
}

export interface PvPly {
  san: string
  uci: string
  color: Color
  is_check: boolean
  is_drop: boolean
}

export interface CandidateFacts {
  rank: number
  evaluation: number | null
  mate: number | null
  evaluation_pov: 'white'
  depth: number
  facts: MoveFacts
  pv: PvPly[]
  forcing_checks: number
}

export interface Insights {
  position_id: string
  analysis_id: string
  engine_status: 'ok' | 'cancelled' | 'game_over'
  position: PositionFacts
  last_move: MoveFacts | null
  candidates: CandidateFacts[]
}

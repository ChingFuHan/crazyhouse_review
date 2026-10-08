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

/** User-chosen engine search settings (lichess-like). movetime_ms null = infinite analysis. */
export interface SearchSettings {
  multipv: number
  depth: number | null
  movetime_ms: number | null
  threads: number
  hash_mb: number
}

export interface EngineAnalysis {
  position_id: string
  /** running = a streamed snapshot of a search still in progress */
  status: 'ok' | 'running' | 'cancelled' | 'game_over'
  engine: string
  multipv: number
  movetime_ms: number | null
  depth: number
  lines: EngineLine[]
  best_move: MoveModel | null
  analysis_id: string
  cached: boolean
  nodes: number | null
  nps: number | null
  elapsed_ms: number | null
  settings: SearchSettings | null
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
  king_zone_attackers: string[]
  board_material: Record<string, number>
}

export interface PositionFacts {
  side_to_move: Color
  in_check: boolean
  checkers: PieceOnSquare[]
  legal_move_count: number
  mate_in_one: string[]
  opponent_mate_threats: string[]
  defenses_to_mate_threats: string[]
  white: SideFacts
  black: SideFacts
}

export interface LineEffect {
  attacker: string
  target: string
}

export interface OpenedFile {
  file: string
  kind: 'open' | 'half_open'
}

export interface ThreatFacts {
  side: Color
  best_move: string
  evaluation: number | null
  mate: number | null
  evaluation_pov: 'white'
  depth: number
  pv: string[]
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
  discovered_attacks: LineEffect[]
  blocked_lines: LineEffect[]
  opened_file: OpenedFile | null
  threatens_mate: string[]
  en_prise_to: string[]
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
  engine_status: 'ok' | 'running' | 'cancelled' | 'game_over'
  /** Search depth of the engine result the facts are based on. */
  depth: number
  position: PositionFacts
  last_move: MoveFacts | null
  candidates: CandidateFacts[]
  threat: ThreatFacts | null
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface CheckedMove {
  input: string
  legal: boolean
  reason: string | null
  san: string | null
  uci: string | null
  source: 'multipv' | 'engine_after_move' | 'rules' | 'not_analyzed' | 'unavailable' | null
  multipv_rank: number | null
  evaluation: number | null
  mate: number | null
  evaluation_pov: 'white'
}

export interface ExplainResponse {
  position_id: string
  variation_id: string
  analysis_id: string
  request_id: string
  context_version: string
  question: string
  text: string
  model: string
  refused: boolean
  cached: boolean
  checked_moves: CheckedMove[]
  /** Automatic post-check: statements in the answer that the engine / rules data does not back. */
  warnings: AnswerWarning[]
  /** Exactly what the model received; null when the rules answered without an LLM. */
  prompt: PromptRecord | null
}

export type LlmProviderId = 'agy' | 'codex' | 'claude'

/** The viewer's AI; null model / effort = the CLI's own default. */
export interface LlmChoice {
  provider: LlmProviderId
  model: string | null
  effort: string | null
}

export interface LlmModelOption {
  id: string
  label: string
  efforts: string[] | null
  default_effort: string | null
}

export interface LlmProviderOption {
  id: LlmProviderId
  label: string
  available: boolean
  reason: string | null
  models: LlmModelOption[]
  efforts: string[]
}

export interface LlmCatalog {
  /** The server's own AI, used when the viewer picks nothing. */
  default: string | null
  default_reason: string | null
  providers: LlmProviderOption[]
}

export interface AnswerWarning {
  kind: 'illegal_move' | 'unanalysed_move' | 'evaluation' | 'mate' | 'advantage'
  quote: string
  detail: string
}

export interface PromptRecord {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export type MoveClassification = 'inaccuracy' | 'mistake' | 'blunder' | 'mate_missed' | 'mate_allowed'

export interface ReviewPly {
  ply: number
  position_id: string
  evaluation: number | null
  mate: number | null
  evaluation_pov: 'white'
  best_move: string | null
  best_before: string | null
  played_best: boolean | null
  /** The played move searched from the previous position (same side to move as the best move). */
  played_evaluation: number | null
  played_mate: number | null
  classification: MoveClassification | null
}

/** A move tried in a position (learning from mistakes), judged like the whole-game review. */
export interface JudgedMove {
  played: MoveModel
  best: MoveModel | null
  chances_best: number
  chances_played: number
  /** null: a good move (the best, or within an inaccuracy of it). */
  verdict: MoveClassification | null
}

export interface ReviewJob {
  job_id: string
  root_fen: string
  moves: string[]
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  plies: ReviewPly[]
  error: string | null
}

export type PuzzleType = 'attack' | 'defense' | 'tactics' | 'battle'

export const PUZZLE_TYPE_NAMES: Record<PuzzleType, string> = {
  attack: '進攻題',
  defense: '防守題',
  tactics: '中局攻防',
  battle: '中局對轟',
}

export interface Player {
  nickname: string
  rating: number
  rd: number
  vol: number
  plays: number
}

/** A puzzle as the solver sees it (never the solution). */
export interface PuzzleView {
  id: number
  type: PuzzleType
  type_name: string
  fen: string
  solver: Color
  solver_moves: number | null
  battle_plies: number | null
  rating: number
  plays: number
  themes: string[]
  rated: boolean
  title: string
  /** The agent that made or picked the puzzle ("" for engine-only puzzles). */
  ai: string
  /** The position before the opponent's last move and that move, when known (shown first). */
  before_fen: string
  last_move: string
  /** Reported as broken: out of the rotation, a link still opens it. */
  disabled: boolean
  report: string
}

/** 0: no hint, 1: the agent's hint in words (half a point), 2: the piece to move (no point). */
export type HintLevel = 0 | 1 | 2

export interface RatingChange {
  rated: boolean
  score: number
  before: number
  after: number
  puzzle_before: number
  puzzle_after: number
}

export interface PuzzleMoveResult {
  correct: boolean
  /** Not the answer but as good by the engine: try again, nothing counted. */
  alternative: boolean
  played: MoveModel | null
  reply: MoveModel | null
  done: boolean
  solution: MoveModel[]
  rating: RatingChange | null
  explanation: string
  ai_warnings: AnswerWarning[]
}

export interface BattleMoveResult {
  played: MoveModel
  verdict: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
  best: MoveModel | null
  chances_best: number
  chances_played: number
  reply: MoveModel | null
  done: boolean
  moves_left: number
  final_chances: number | null
  result: number | null
  rating: RatingChange | null
  explanation: string
  ai_warnings: AnswerWarning[]
}

export interface PuzzleHint {
  square: string | null
  drop: string | null
  /** The agent's hint in words (never the move itself). */
  text: string
}

export interface PuzzleJob {
  job_id: string
  kind: 'mine' | 'generate'
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  found: number
  message: string
  log: string[]
  ai: string
  /** The puzzles stored when the job is done, to open directly. */
  made: { id: number; type: PuzzleType; type_name: string; title: string }[]
}

export interface GenerateOptions {
  mode: 'curate' | 'design'
  count: number
  types: PuzzleType[]
  type: PuzzleType
  description: string
  llm: LlmChoice | null
}

export interface PuzzleExport {
  fen: string
  lichess_fen: string
  pgn: string
  lichess_analysis_url: string
  solution_shown: boolean
}

export interface PuzzleStats {
  total: number
  by_type: Record<PuzzleType, number>
}

export interface PuzzleTexts {
  title: string
  hint: string
  explanation: string
  ai: string
  ai_warnings: AnswerWarning[]
}

export type PuzzleSource = 'game' | 'selfplay' | 'manual' | 'design'

export interface PuzzleSummary {
  id: number
  type: PuzzleType
  type_name: string
  title: string
  rating: number
  plays: number
  wins: number
  source: PuzzleSource
  ai: string
  disabled: boolean
  report: string
}

export interface PlayerHistory {
  player: Player
  /** Newest first. */
  attempts: { puzzle: PuzzleSummary; score: number; before: number; after: number; at: number }[]
  by_type: Partial<Record<PuzzleType, { plays: number; score: number }>>
}

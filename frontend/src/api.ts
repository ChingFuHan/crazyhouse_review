import type { ExportNode } from './exportPgn'
import type { LlmMeta } from './llmRequest'
import type {
  ChatTurn,
  Color,
  LlmCatalog,
  LlmChoice,
  BattleMoveResult,
  Player,
  PuzzleExport,
  PuzzleHint,
  PuzzleJob,
  PuzzleMoveResult,
  PuzzleStats,
  PuzzleType,
  PuzzleView,
  EngineAnalysis,
  ExplainResponse,
  GameTreeDto,
  Insights,
  PositionState,
  ReviewJob,
  SearchSettings,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  await throwIfFailed(response)
  return (await response.json()) as T
}

async function throwIfFailed(response: Response): Promise<void> {
  if (!response.ok) {
    let code = 'http_error'
    let message = `${response.status} ${response.statusText}`
    try {
      const detail = (await response.json()).detail
      if (detail && typeof detail === 'object') {
        code = detail.error ?? code
        message = detail.message ?? message
      } else if (typeof detail === 'string') {
        message = detail
      }
    } catch {
      // keep the HTTP status message
    }
    throw new ApiError(response.status, code, message)
  }
}

/** Parse a text/event-stream body: calls `onEvent(name, data)` for each complete event. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: unknown) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }) // multi-byte characters may span chunks
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data.push(line.slice(6))
      }
      if (data.length) onEvent(event, JSON.parse(data.join('\n')))
    }
  }
}

/** A line identifies a position: root FEN + UCI moves (+ the id the client believes it has). */
export interface LineRef {
  root_fen: string
  moves: string[]
  position_id: string
}

export function lineOf(state: PositionState): LineRef {
  return { root_fen: state.root_fen, moves: state.moves, position_id: state.position_id }
}

/** An answer stream: `progress` (whole-game review), `delta` text chunks, then `done` or `error`. */
async function readAnswer(
  response: Response,
  onDelta: (textSoFar: string) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<ExplainResponse> {
  await throwIfFailed(response)
  let text = ''
  let final: ExplainResponse | null = null
  let failure: ApiError | null = null
  await readSse(response.body!, (event, data) => {
    if (event === 'delta') {
      text += (data as { text: string }).text
      onDelta(text)
    } else if (event === 'progress') {
      const { done, total } = data as { done: number; total: number }
      onProgress?.(done, total)
    } else if (event === 'done') {
      final = data as ExplainResponse
    } else if (event === 'error') {
      const { error, message } = data as { error: string; message: string }
      failure = new ApiError(502, error, message)
    }
  })
  if (failure) throw failure
  if (!final) throw new ApiError(502, 'stream_incomplete', 'AI 回答串流中斷')
  return final
}

export const api = {
  startPosition: (rootFen?: string) => post<PositionState>('/api/position', { root_fen: rootFen ?? null, moves: [] }),
  /** The canonical state of a line (legal moves, pockets…). */
  position: (rootFen: string, moves: string[], signal?: AbortSignal) =>
    post<PositionState>('/api/position', { root_fen: rootFen, moves }, signal),
  move: (from: PositionState, move: string) => post<PositionState>('/api/move', { ...lineOf(from), move }),
  loadPgn: (pgn: string) => post<GameTreeDto>('/api/pgn', { pgn }),
  /** Streamed analysis with the viewer's settings: `onSnapshot` gets each deeper result; resolves with
   * the final one (ok when the depth/time limit was reached or the search was stopped). */
  analyzeStream: async (
    position: PositionState,
    settings: SearchSettings,
    onSnapshot: (analysis: EngineAnalysis) => void,
    signal?: AbortSignal,
  ): Promise<EngineAnalysis> => {
    const response = await fetch('/api/analyze/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...lineOf(position), settings }),
      signal,
    })
    await throwIfFailed(response)
    let final: EngineAnalysis | null = null
    let failure: ApiError | null = null
    await readSse(response.body!, (event, data) => {
      if (event === 'snapshot') onSnapshot(data as EngineAnalysis)
      else if (event === 'done') final = data as EngineAnalysis
      else if (event === 'error') failure = new ApiError(503, 'engine_unavailable', (data as { message: string }).message)
    })
    if (failure) throw failure
    if (!final) throw new ApiError(502, 'stream_incomplete', 'Engine 分析串流中斷')
    return final
  },
  /** Finish the running analysis of this position now (it counts as complete). */
  stopAnalysis: (positionId: string) => post<{ stopped: boolean }>('/api/analyze/stop', { position_id: positionId }),
  /** Deterministic facts for exactly the displayed engine result (`analysisId`). */
  insights: (position: PositionState, analysisId: string, signal?: AbortSignal) =>
    post<Insights>('/api/insights', { ...lineOf(position), analysis_id: analysisId }, signal),
  /** Ask the LLM about this position (null question = explain the best move), streamed: `onDelta`
   * receives the answer text so far; `llm` = the viewer's AI (null: the server default). */
  explainStream: async (
    position: PositionState,
    meta: LlmMeta,
    question: string | null,
    history: ChatTurn[],
    analysisId: string | null,
    llm: LlmChoice | null,
    onDelta: (textSoFar: string) => void,
    signal?: AbortSignal,
  ): Promise<ExplainResponse> => {
    const response = await fetch('/api/explain/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // analysis_id: explain exactly the engine result on screen
      body: JSON.stringify({ ...lineOf(position), ...meta, question, history, analysis_id: analysisId, llm }),
      signal,
    })
    return readAnswer(response, onDelta)
  },
  /** Whole-game scan of one side's errors over the main line ending at `last`: `onProgress` follows
   * the whole-game review the scan needs, `onDelta` the answer text so far. */
  gameScanStream: async (
    last: PositionState,
    side: Color,
    headers: Record<string, string>,
    llm: LlmChoice | null,
    onProgress: (done: number, total: number) => void,
    onDelta: (textSoFar: string) => void,
    signal?: AbortSignal,
  ): Promise<ExplainResponse> => {
    const response = await fetch('/api/explain/game/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root_fen: last.root_fen, moves: last.moves, side, headers, llm }),
      signal,
    })
    return readAnswer(response, onDelta, onProgress)
  },
  /** The AI CLIs, models and effort levels on offer, as the CLIs list them (`refresh`: read them anew). */
  llmCatalog: (refresh: boolean, signal?: AbortSignal) =>
    request<LlmCatalog>(`/api/llm/catalog${refresh ? '?refresh=true' : ''}`, { signal }),
  /** PGN of the whole tree (main line, PGN and user variations, comments), validated by the backend. */
  exportPgn: (rootFen: string, headers: Record<string, string>, nodes: ExportNode[]) =>
    post<{ pgn: string }>('/api/export', { root_fen: rootFen, headers, nodes }),
  // --- puzzles ---
  signIn: (nickname: string) => post<Player>('/api/players', { nickname }),
  nextPuzzle: (player: string, types: PuzzleType[]) =>
    request<PuzzleView>(`/api/puzzles/next?player=${encodeURIComponent(player)}&types=${types.join(',')}`, {}),
  puzzleMove: (id: number, player: string, moves: string[], move: string, hintUsed: boolean) =>
    post<PuzzleMoveResult>(`/api/puzzles/${id}/move`, { player, moves, move, hint_used: hintUsed }),
  battleMove: (id: number, player: string, moves: string[], move: string) =>
    post<BattleMoveResult>(`/api/puzzles/${id}/battle`, { player, moves, move }),
  giveUp: (id: number, player: string) => post<PuzzleMoveResult>(`/api/puzzles/${id}/giveup`, { player }),
  puzzleHint: (id: number, moves: string[]) => post<PuzzleHint>(`/api/puzzles/${id}/hint`, { moves }),
  exportPuzzle: (id: number, player: string) =>
    request<PuzzleExport>(`/api/puzzles/${id}/export?player=${encodeURIComponent(player)}`, {}),
  createPuzzle: (position: PositionState, type: PuzzleType) =>
    post<PuzzleView>('/api/puzzles', { root_fen: position.root_fen, moves: position.moves, type }),
  minePuzzles: (last: PositionState, label: string) =>
    post<PuzzleJob>('/api/puzzles/mine', { root_fen: last.root_fen, moves: last.moves, label }),
  generatePuzzles: (count: number, types: PuzzleType[]) => post<PuzzleJob>('/api/puzzles/generate', { count, types }),
  puzzleJob: (jobId: string) => request<PuzzleJob>(`/api/puzzle-jobs/${jobId}`, {}),
  puzzleStats: () => request<PuzzleStats>('/api/puzzles/stats', {}),
  /** Whole-game review of a line (the main line), run on the backend's separate review engine. */
  startReview: (last: PositionState) => post<ReviewJob>('/api/review', { root_fen: last.root_fen, moves: last.moves }),
  getReview: (jobId: string, signal?: AbortSignal) => request<ReviewJob>(`/api/review/${jobId}`, { signal }),
}

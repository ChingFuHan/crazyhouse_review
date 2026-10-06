import type { ExportNode } from './exportPgn'
import type { LlmMeta } from './llmRequest'
import type {
  ChatTurn,
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

export const api = {
  startPosition: (rootFen?: string) => post<PositionState>('/api/position', { root_fen: rootFen ?? null, moves: [] }),
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
  /** Ask the LLM about this position; null question = explain the best move. */
  explain: (
    position: PositionState,
    meta: LlmMeta,
    question: string | null,
    history: ChatTurn[],
    analysisId: string | null,
    signal?: AbortSignal,
  ) => post<ExplainResponse>('/api/explain', { ...lineOf(position), ...meta, question, history, analysis_id: analysisId }, signal),
  /** Same as `explain`, streamed: `onDelta` receives the answer text so far. */
  explainStream: async (
    position: PositionState,
    meta: LlmMeta,
    question: string | null,
    history: ChatTurn[],
    analysisId: string | null,
    onDelta: (textSoFar: string) => void,
    signal?: AbortSignal,
  ): Promise<ExplainResponse> => {
    const response = await fetch('/api/explain/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // analysis_id: explain exactly the engine result on screen
      body: JSON.stringify({ ...lineOf(position), ...meta, question, history, analysis_id: analysisId }),
      signal,
    })
    await throwIfFailed(response)
    let text = ''
    let final: ExplainResponse | null = null
    let failure: ApiError | null = null
    await readSse(response.body!, (event, data) => {
      if (event === 'delta') {
        text += (data as { text: string }).text
        onDelta(text)
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
  },
  /** PGN of the whole tree (main line, PGN and user variations, comments), validated by the backend. */
  exportPgn: (rootFen: string, headers: Record<string, string>, nodes: ExportNode[]) =>
    post<{ pgn: string }>('/api/export', { root_fen: rootFen, headers, nodes }),
  /** Whole-game review of a line (the main line), run on the backend's separate review engine. */
  startReview: (last: PositionState) => post<ReviewJob>('/api/review', { root_fen: last.root_fen, moves: last.moves }),
  getReview: (jobId: string, signal?: AbortSignal) => request<ReviewJob>(`/api/review/${jobId}`, { signal }),
}

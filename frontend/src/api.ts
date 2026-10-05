import type { EngineAnalysis, GameTreeDto, Insights, PositionState } from './types'

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
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
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
  return (await response.json()) as T
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
  analyze: (position: PositionState, options: { movetimeMs?: number; multipv?: number }, signal?: AbortSignal) =>
    post<EngineAnalysis>(
      '/api/analyze',
      { ...lineOf(position), movetime_ms: options.movetimeMs ?? null, multipv: options.multipv ?? null },
      signal,
    ),
  /** Engine result (same cache as `analyze` with default settings) + deterministic facts. */
  insights: (position: PositionState, signal?: AbortSignal) =>
    post<Insights>('/api/insights', { ...lineOf(position), movetime_ms: null, multipv: null }, signal),
}

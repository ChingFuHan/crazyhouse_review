import type { GameTreeDto, PositionState } from './types'

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
}

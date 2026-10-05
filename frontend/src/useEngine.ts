// Engine analysis bound to the active position.
// A result is only ever exposed for the position_id it was computed for.

import { useEffect, useState } from 'react'
import { api } from './api'
import type { EngineAnalysis, PositionState } from './types'

const DEBOUNCE_MS = 120
/** Quick look first, then the server's default full-length search (both cached by the backend).
 * The full phase must use the server default so /api/insights reuses the very same result. */
const PHASES_MS: (number | undefined)[] = [300, undefined]

export type EngineStatus = 'idle' | 'analyzing' | 'done' | 'error'

interface EngineState {
  positionId: string
  status: EngineStatus
  analysis: EngineAnalysis | null
  error: string | null
}

export interface EngineView {
  status: EngineStatus
  analysis: EngineAnalysis | null
  error: string | null
}

export function useEngine(position: PositionState | null, enabled = true): EngineView {
  const [state, setState] = useState<EngineState | null>(null)
  const positionId = position?.position_id

  useEffect(() => {
    if (!position || !enabled) return
    const controller = new AbortController()
    const id = position.position_id
    const update = (patch: Partial<EngineState>) =>
      setState((prev) => ({
        ...(prev?.positionId === id ? prev : { positionId: id, status: 'idle', analysis: null, error: null }),
        ...patch,
      }))

    const timer = setTimeout(async () => {
      update({ status: 'analyzing' })
      try {
        for (const movetimeMs of PHASES_MS) {
          const result = await api.analyze(position, { movetimeMs }, controller.signal)
          if (controller.signal.aborted) return
          if (result.position_id !== id) throw new Error(`engine answered for ${result.position_id}, expected ${id}`)
          if (result.status === 'cancelled') continue // superseded on the server; try the next phase
          update({ analysis: result })
          if (result.status === 'game_over') break
        }
        update({ status: 'done' })
      } catch (error) {
        if (controller.signal.aborted) return
        update({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // position object identity changes only together with position_id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId, enabled])

  if (!positionId || !enabled || state?.positionId !== positionId) {
    return { status: enabled && positionId ? 'analyzing' : 'idle', analysis: null, error: null }
  }
  return { status: state.status, analysis: state.analysis, error: state.error }
}

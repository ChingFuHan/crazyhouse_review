// Deterministic facts for the active position, computed from exactly the engine result they describe:
// the final analysis once done, or the latest depth milestone while a long search is still running.

import { useEffect, useState } from 'react'
import { api } from './api'
import type { Insights, PositionState } from './types'
import type { EngineView } from './useEngine'

export interface InsightsView {
  insights: Insights | null
  /** Facts for a newer engine result are on their way (the shown ones, if any, are for this position). */
  loading: boolean
  error: string | null
  /** The facts were computed from a different engine result than the one displayed. */
  engineMismatch: boolean
}

interface State {
  key: string
  positionId: string
  insights: Insights | null
  error: string | null
}

export function useInsights(position: PositionState | null, engine: EngineView): InsightsView {
  const [state, setState] = useState<State | null>(null)
  const basis = engine.status === 'done' ? engine.analysis : engine.milestone
  const key =
    position && basis && basis.position_id === position.position_id ? `${position.position_id}:${basis.analysis_id}` : null

  useEffect(() => {
    if (!position || !basis || !key) return
    const controller = new AbortController()
    const positionId = position.position_id
    api
      .insights(position, basis.analysis_id, controller.signal)
      .then((insights) => {
        if (insights.position_id !== positionId) throw new Error('insights for another position')
        setState({ key, positionId, insights, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ key, positionId, insights: null, error: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => controller.abort()
    // the key captures position_id + analysis_id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key) return { insights: null, loading: false, error: null, engineMismatch: false }
  if (state?.key !== key) {
    // Keep showing the previous (shallower) facts of this same position until the new ones arrive.
    const previous = state?.positionId === position?.position_id ? state?.insights ?? null : null
    return { insights: previous, loading: true, error: null, engineMismatch: false }
  }
  return {
    insights: state.insights,
    loading: false,
    error: state.error,
    engineMismatch:
      engine.status === 'done' && state.insights !== null && state.insights.analysis_id !== engine.analysis?.analysis_id,
  }
}

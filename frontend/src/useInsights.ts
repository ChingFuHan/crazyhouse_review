// Deterministic facts for the active position, fetched once its engine analysis is final.

import { useEffect, useState } from 'react'
import { api } from './api'
import type { Insights, PositionState } from './types'
import type { EngineView } from './useEngine'

export interface InsightsView {
  insights: Insights | null
  loading: boolean
  error: string | null
  /** The facts were computed from a different engine result than the one displayed. */
  engineMismatch: boolean
}

interface State {
  key: string
  insights: Insights | null
  error: string | null
}

export function useInsights(position: PositionState | null, engine: EngineView): InsightsView {
  const [state, setState] = useState<State | null>(null)
  const analysis = engine.status === 'done' ? engine.analysis : null
  const key = position && analysis && analysis.position_id === position.position_id ? `${position.position_id}:${analysis.analysis_id}` : null

  useEffect(() => {
    if (!position || !key) return
    const controller = new AbortController()
    api
      .insights(position, controller.signal)
      .then((insights) => {
        if (insights.position_id !== position.position_id) throw new Error('insights for another position')
        setState({ key, insights, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, insights: null, error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
    // the key captures position_id + analysis_id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key || state?.key !== key) return { insights: null, loading: key !== null, error: null, engineMismatch: false }
  return {
    insights: state.insights,
    loading: false,
    error: state.error,
    engineMismatch: state.insights !== null && state.insights.analysis_id !== analysis?.analysis_id,
  }
}

// Engine analysis of the active position with the viewer's settings, streamed as the search deepens.
// A result is only ever exposed for the position_id (and settings) it was computed for.

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { settingsKey } from './engineSettings'
import type { EngineAnalysis, PositionState, SearchSettings } from './types'

const DEBOUNCE_MS = 120
/** Searches at least this long (or infinite) publish depth milestones before they finish, so the
 * fact panel need not wait for the end; shorter ones are only described once done. */
const LONG_SEARCH_MS = 10_000
/** Depth steps at which a running analysis is "good enough" to refresh the fact panel. */
const MILESTONE_STEP = 5
const FIRST_MILESTONE = 10

/** analyzing: snapshots arriving · done: depth/time limit reached or stopped · stopped: interrupted
 * by another request (e.g. another tab) before finishing. */
export type EngineStatus = 'idle' | 'analyzing' | 'done' | 'stopped' | 'error'

interface EngineState {
  key: string
  status: EngineStatus
  analysis: EngineAnalysis | null
  /** Long searches only: the first snapshot that reached the latest depth milestone (10, 15, 20, …). */
  milestone: EngineAnalysis | null
  error: string | null
}

export interface EngineView {
  status: EngineStatus
  analysis: EngineAnalysis | null
  milestone: EngineAnalysis | null
  error: string | null
  /** Finish the running search now (it counts as complete). */
  stop: () => void
  /** Search again (after an interruption or an error). */
  restart: () => void
}

const milestoneOf = (depth: number) => Math.floor(depth / MILESTONE_STEP) * MILESTONE_STEP

export function nextMilestone(previous: EngineAnalysis | null, snapshot: EngineAnalysis): EngineAnalysis | null {
  const step = milestoneOf(snapshot.depth)
  if (step < FIRST_MILESTONE) return previous
  return previous && milestoneOf(previous.depth) >= step ? previous : snapshot
}

export function useEngine(position: PositionState | null, enabled: boolean, settings: SearchSettings): EngineView {
  const [state, setState] = useState<EngineState | null>(null)
  const [nonce, setNonce] = useState(0)
  const positionId = position?.position_id
  const key = positionId && enabled ? `${positionId}|${settingsKey(settings)}|${nonce}` : null

  useEffect(() => {
    if (!position || !key) return
    const controller = new AbortController()
    const id = position.position_id
    const long = settings.movetime_ms === null || settings.movetime_ms >= LONG_SEARCH_MS
    const fresh = (): EngineState => ({ key, status: 'analyzing', analysis: null, milestone: null, error: null })
    const update = (patch: (base: EngineState) => Partial<EngineState>) =>
      setState((prev) => {
        const base = prev?.key === key ? prev : fresh()
        return { ...base, ...patch(base) }
      })

    const timer = setTimeout(async () => {
      update(() => ({ status: 'analyzing' }))
      try {
        const final = await api.analyzeStream(
          position,
          settings,
          (snapshot) => {
            if (controller.signal.aborted || snapshot.position_id !== id) return
            update((base) => ({ analysis: snapshot, milestone: long ? nextMilestone(base.milestone, snapshot) : null }))
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (final.position_id !== id) throw new Error(`engine answered for ${final.position_id}, expected ${id}`)
        if (final.status === 'cancelled') {
          update((base) => ({ status: 'stopped', analysis: final.lines.length ? final : base.analysis }))
        } else {
          update(() => ({ status: 'done', analysis: final }))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        update(() => ({ status: 'error', error: error instanceof Error ? error.message : String(error) }))
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort() // closes the stream: the server stops this search
    }
    // `key` captures position_id, settings and restarts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const stop = useCallback(() => {
    if (positionId) void api.stopAnalysis(positionId)
  }, [positionId])
  const restart = useCallback(() => setNonce((n) => n + 1), [])

  if (!key || state?.key !== key) {
    return { status: key ? 'analyzing' : 'idle', analysis: null, milestone: null, error: null, stop, restart }
  }
  return { ...state, stop, restart }
}

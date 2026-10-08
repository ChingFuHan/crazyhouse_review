// Whole-game review of the main line: start a backend job and poll it (by itself when `auto`, once
// the main line has moves and has no review yet). Results are keyed by position_id, so they can only
// ever annotate the exact positions analysed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { type GameTree, mainline } from './tree'
import type { ReviewJob, ReviewPly } from './types'

const POLL_MS = 600

export interface GameReview {
  job: ReviewJob | null
  error: string | null
  byPosition: Map<string, ReviewPly>
  start: () => void
}

export function useGameReview(tree: GameTree | null, auto = false): GameReview {
  const [job, setJob] = useState<ReviewJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const rootId = tree?.rootId

  // A new game invalidates any review in progress.
  useEffect(() => {
    generation.current += 1
    return () => {
      generation.current += 1
    }
  }, [rootId])

  const start = useCallback(() => {
    if (!tree) return
    const line = mainline(tree)
    const last = tree.nodes[line[line.length - 1]].state
    const mine = ++generation.current
    setError(null)
    void (async () => {
      try {
        let current = await api.startReview(last)
        while (mine === generation.current) {
          setJob(current)
          if (current.status !== 'running') {
            if (current.status === 'error') setError(current.error)
            return
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS))
          if (mine !== generation.current) return
          current = await api.getReview(current.job_id)
        }
      } catch (e) {
        if (mine === generation.current) setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [tree])

  // Show a job only for the main line it analysed (a new PGN from the same start is another line).
  const last = tree ? tree.nodes[mainline(tree).at(-1)!].state : null
  const visible = job && last && job.root_fen === last.root_fen && job.moves.join(' ') === last.moves.join(' ') ? job : null
  const byPosition = useMemo(() => new Map((visible?.plies ?? []).map((p) => [p.position_id, p])), [visible])

  const startLatest = useRef(start)
  useEffect(() => {
    startLatest.current = start
  }, [start])
  const mainKey = last ? `${last.root_fen}|${last.moves.join(' ')}` : ''
  const hasMoves = (last?.moves.length ?? 0) > 0
  const reviewed = visible !== null
  useEffect(() => {
    if (auto && hasMoves && !reviewed) startLatest.current()
    // a new main line (a game loaded, a line promoted) or turning auto on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, mainKey])
  return { job: visible, error, byPosition, start }
}

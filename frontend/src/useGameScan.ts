// Whole-game scan of one side's errors (AI, grounded on the whole-game review of the main line).
// Results belong to the main line they were computed for: a new game or a changed main line hides them.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from './api'
import { type GameTree, mainline } from './tree'
import type { Color, LlmChoice } from './types'
import type { Turn } from './useConversation'

export interface ScanState extends Turn {
  /** Whole-game review progress (positions analysed / total) while the scan waits for it. */
  progress: { done: number; total: number } | null
}

export interface GameScan {
  scans: Partial<Record<Color, ScanState>>
  start: (side: Color, llm: LlmChoice | null) => void
}

const SIDE_LABELS: Record<Color, string> = { white: '白方', black: '黑方' }

export function scanLabel(side: Color): string {
  return `全局掃描：${SIDE_LABELS[side]} miss 的錯誤`
}

function lineKey(tree: GameTree | null): string | null {
  if (!tree) return null
  const last = tree.nodes[mainline(tree).at(-1)!].state
  return `${last.root_fen}|${last.moves.join(' ')}`
}

export function useGameScan(tree: GameTree | null): GameScan {
  const key = lineKey(tree)
  const [state, setState] = useState<{ key: string | null; scans: Partial<Record<Color, ScanState>> }>({ key, scans: {} })
  const controllers = useRef(new Set<AbortController>())
  const nextId = useRef(1)

  // A different main line cancels running scans (their results would describe another game).
  useEffect(() => {
    const running = controllers.current
    return () => {
      running.forEach((c) => c.abort())
      running.clear()
    }
  }, [key])

  const start = useCallback(
    (side: Color, llm: LlmChoice | null) => {
      if (!tree || !key) return
      const last = tree.nodes[mainline(tree).at(-1)!].state
      const id = nextId.current++
      // Only this scan's own entry: a newer scan of the same side replaces it.
      const update = (patch: Partial<ScanState>) =>
        setState((current) =>
          current.key === key && current.scans[side]?.id === id
            ? { key, scans: { ...current.scans, [side]: { ...current.scans[side]!, ...patch } } }
            : current,
        )
      const fresh: ScanState = {
        id,
        question: scanLabel(side),
        answer: null,
        partial: '',
        error: null,
        pending: true,
        progress: null,
      }
      setState((current) => ({ key, scans: { ...(current.key === key ? current.scans : {}), [side]: fresh } }))
      const controller = new AbortController()
      controllers.current.add(controller)
      api
        .gameScanStream(
          last,
          side,
          tree.headers,
          llm,
          (done, total) => update({ progress: { done, total } }),
          (partial) => update({ partial }),
          controller.signal,
        )
        .then((answer) => update({ answer, pending: false }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          update({ error: error instanceof ApiError || error instanceof Error ? error.message : String(error), pending: false })
        })
        .finally(() => controllers.current.delete(controller))
    },
    [tree, key],
  )

  return { scans: state.key === key ? state.scans : {}, start }
}

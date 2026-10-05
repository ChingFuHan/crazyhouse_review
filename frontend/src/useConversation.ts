// Questions and LLM answers per (position_id, variation_id).
// An answer is stored under the position it was asked about; switching positions never shows
// another position's answer, and late answers land in their own position's history.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from './api'
import { llmMeta } from './llmRequest'
import type { GameTree } from './tree'
import type { ChatTurn, ExplainResponse, PositionState } from './types'

/** Prior turns sent with a follow-up question. */
const HISTORY_TURNS = 6

export interface Turn {
  id: number
  /** null = "explain the best move" */
  question: string | null
  answer: ExplainResponse | null
  /** Answer text received so far while streaming. */
  partial: string
  error: string | null
  pending: boolean
}

export function conversationKey(position: PositionState, variationId: string): string {
  return `${position.position_id}|${variationId}`
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : String(error)
}

export function useConversation(tree: GameTree | null, activeId: string | null) {
  const [threads, setThreads] = useState<Record<string, Turn[]>>({})
  const nextId = useRef(1)
  const controllers = useRef(new Set<AbortController>())

  useEffect(() => {
    const all = controllers.current
    return () => all.forEach((c) => c.abort())
  }, [])

  const node = tree && activeId ? tree.nodes[activeId] : null
  const key = node ? conversationKey(node.state, node.variationId) : null

  const ask = useCallback(
    async (question: string | null) => {
      if (!tree || !activeId) return
      const position = tree.nodes[activeId].state
      const meta = llmMeta(tree, activeId)
      const threadKey = conversationKey(position, meta.variation_id)
      const id = nextId.current++
      const previous = threads[threadKey] ?? []
      const history: ChatTurn[] = previous
        .filter((t) => t.answer && !t.answer.refused)
        .slice(-HISTORY_TURNS)
        .flatMap((t) => [
          { role: 'user' as const, content: t.answer!.question },
          { role: 'assistant' as const, content: t.answer!.text },
        ])
      const update = (patch: Partial<Turn>) =>
        setThreads((all) => ({
          ...all,
          [threadKey]: (all[threadKey] ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }))
      setThreads((all) => ({
        ...all,
        [threadKey]: [...(all[threadKey] ?? []), { id, question, answer: null, partial: '', error: null, pending: true }],
      }))
      const controller = new AbortController()
      controllers.current.add(controller)
      try {
        const answer = await api.explainStream(
          position,
          meta,
          question,
          history,
          (partial) => update({ partial }),
          controller.signal,
        )
        if (answer.position_id !== position.position_id || answer.variation_id !== meta.variation_id) {
          throw new Error('answer belongs to a different position')
        }
        update({ answer, pending: false })
      } catch (error) {
        if (!controller.signal.aborted) update({ error: errorText(error), pending: false })
      } finally {
        controllers.current.delete(controller)
      }
    },
    [tree, activeId, threads],
  )

  return { key, turns: key ? (threads[key] ?? []) : [], ask }
}

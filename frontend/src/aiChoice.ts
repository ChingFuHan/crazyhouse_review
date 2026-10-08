// The AI the viewer picked (kept in this browser). The options always come from the server's live
// catalog of the installed CLIs, so a choice the CLI no longer offers falls back to the default.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { LlmCatalog, LlmChoice, LlmProviderOption } from './types'

const KEY = 'crazyhouse-review:ai-choice'

export function loadChoice(key: string = KEY): LlmChoice | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as LlmChoice | null
    return raw && typeof raw.provider === 'string' ? { provider: raw.provider, model: raw.model ?? null, effort: raw.effort ?? null } : null
  } catch {
    return null
  }
}

function saveChoice(key: string, choice: LlmChoice | null) {
  try {
    if (choice) localStorage.setItem(key, JSON.stringify(choice))
    else localStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

/** Effort levels for a model of this CLI (the model's own list when the CLI gives one). */
export function effortsFor(option: LlmProviderOption, model: string | null): string[] {
  const listed = option.models.find((m) => m.id === model)?.efforts
  return listed && listed.length > 0 ? listed : option.efforts
}

/** Keep what the catalog still offers; `dropped` names what had to be reset. */
export function sanitizeChoice(choice: LlmChoice | null, catalog: LlmCatalog): { choice: LlmChoice | null; dropped: string | null } {
  if (!choice) return { choice: null, dropped: null }
  const option = catalog.providers.find((p) => p.id === choice.provider)
  if (!option || !option.available) return { choice: null, dropped: `${option?.label ?? choice.provider} 目前無法使用` }
  if (choice.model !== null && !option.models.some((m) => m.id === choice.model)) {
    return { choice: { ...choice, model: null, effort: null }, dropped: `model「${choice.model}」已不提供` }
  }
  if (choice.effort !== null && !effortsFor(option, choice.model).includes(choice.effort)) {
    return { choice: { ...choice, effort: null }, dropped: `effort「${choice.effort}」已不提供` }
  }
  return { choice, dropped: null }
}

export function describeChoice(choice: LlmChoice | null, catalog: LlmCatalog | null): string {
  if (!choice) return `伺服器預設${catalog?.default ? `（${catalog.default}）` : ''}`
  const label = catalog?.providers.find((p) => p.id === choice.provider)?.label ?? choice.provider
  return [label, choice.model ?? 'CLI 預設 model', choice.effort ? `effort ${choice.effort}` : null].filter(Boolean).join(' · ')
}

export interface AiChoiceView {
  choice: LlmChoice | null
  setChoice: (choice: LlmChoice | null) => void
  catalog: LlmCatalog | null
  loading: boolean
  error: string | null
  /** What the latest catalog no longer offered (the choice was reset accordingly). */
  dropped: string | null
  /** Ask the CLIs again (opening the settings does this). */
  refresh: () => void
}

/** `storageKey`: each place that picks an AI (questions, making puzzles) keeps its own choice. */
export function useAiChoice(storageKey: string = KEY): AiChoiceView {
  const [choice, setStored] = useState<LlmChoice | null>(() => loadChoice(storageKey))
  const [catalog, setCatalog] = useState<LlmCatalog | null>(null)
  const [loading, setLoading] = useState(true) // the first catalog is read on mount
  const [error, setError] = useState<string | null>(null)
  const [dropped, setDropped] = useState<string | null>(null)
  const [request, setRequest] = useState({ refresh: false, n: 0 })
  const current = useRef(choice)
  useEffect(() => {
    current.current = choice
  }, [choice])

  const setChoice = useCallback(
    (next: LlmChoice | null) => {
      saveChoice(storageKey, next)
      setStored(next)
      setDropped(null)
    },
    [storageKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    api
      .llmCatalog(request.refresh, controller.signal)
      .then((fresh) => {
        setCatalog(fresh)
        setError(null)
        const result = sanitizeChoice(current.current, fresh)
        if (result.dropped) {
          saveChoice(storageKey, result.choice)
          setStored(result.choice)
          setDropped(result.dropped)
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [request, storageKey])

  const refresh = useCallback(() => {
    setLoading(true)
    setRequest((r) => ({ refresh: true, n: r.n + 1 }))
  }, [])
  return { choice, setChoice, catalog, loading, error, dropped, refresh }
}

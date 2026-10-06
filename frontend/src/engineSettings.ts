// Engine search settings chosen by the viewer (kept in this browser). The server validates them again.

import { useCallback, useState } from 'react'
import type { SearchSettings } from './types'

export const DEFAULT_SETTINGS: SearchSettings = { multipv: 3, depth: null, movetime_ms: 3000, threads: 4, hash_mb: 256 }

export const OPTIONS = {
  multipv: [1, 2, 3, 4, 5],
  depth: [null, 15, 20, 25, 30, 40] as (number | null)[],
  movetime_ms: [1000, 3000, 5000, 10_000, 30_000, 60_000, null] as (number | null)[],
  threads: [1, 2, 3, 4, 5, 6, 7],
  hash_mb: [64, 128, 256, 512, 1024, 2048, 4096],
}

const KEY = 'crazyhouse-review:engine-settings'

function pick<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Keep only values the UI offers; anything else falls back to the default. */
export function sanitize(raw: unknown): SearchSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<SearchSettings>
  return {
    multipv: pick(value.multipv, OPTIONS.multipv, DEFAULT_SETTINGS.multipv),
    depth: pick(value.depth, OPTIONS.depth, DEFAULT_SETTINGS.depth),
    movetime_ms: pick(value.movetime_ms, OPTIONS.movetime_ms, DEFAULT_SETTINGS.movetime_ms),
    threads: pick(value.threads, OPTIONS.threads, DEFAULT_SETTINGS.threads),
    hash_mb: pick(value.hash_mb, OPTIONS.hash_mb, DEFAULT_SETTINGS.hash_mb),
  }
}

export function loadSettings(): SearchSettings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: SearchSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // best-effort
  }
}

export function settingsKey(s: SearchSettings): string {
  return `${s.multipv}/${s.depth ?? '-'}/${s.movetime_ms ?? 'inf'}/${s.threads}/${s.hash_mb}`
}

export const describe = {
  depth: (d: number | null) => (d === null ? '不限' : `${d}`),
  time: (ms: number | null) => (ms === null ? '無限' : `${ms / 1000} 秒`),
  hash: (mb: number) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`),
  nps: (nps: number | null) => (nps === null ? '' : nps >= 1e6 ? `${(nps / 1e6).toFixed(1)} M/s` : `${Math.round(nps / 1e3)} k/s`),
}

export function useEngineSettings(): [SearchSettings, (settings: SearchSettings) => void] {
  const [settings, setSettings] = useState(loadSettings)
  const change = useCallback((next: SearchSettings) => {
    const clean = sanitize(next)
    saveSettings(clean)
    setSettings(clean)
  }, [])
  return [settings, change]
}

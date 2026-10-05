// Per-viewer UI preferences in localStorage. Storage may be unavailable (private mode, blocked
// site data), so reads fall back to the default and writes are best-effort.

import { useCallback, useState } from 'react'

const PREFIX = 'crazyhouse-review:'

function read(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(PREFIX + key)
    return value === null ? fallback : value === 'on'
  } catch {
    return fallback
  }
}

function write(key: string, value: boolean) {
  try {
    localStorage.setItem(PREFIX + key, value ? 'on' : 'off')
  } catch {
    // best-effort
  }
}

export function useBooleanPreference(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => read(key, fallback))
  const toggle = useCallback(() => {
    setValue((current) => {
      write(key, !current)
      return !current
    })
  }, [key])
  return [value, toggle]
}

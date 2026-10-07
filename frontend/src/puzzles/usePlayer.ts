// The signed-in puzzle player (a nickname on the server; remembered in this browser).

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Player } from '../types'

const KEY = 'crazyhouse-review:player'

function stored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function remember(nickname: string | null) {
  try {
    if (nickname) localStorage.setItem(KEY, nickname)
    else localStorage.removeItem(KEY)
  } catch {
    // best-effort
  }
}

export interface PlayerView {
  player: Player | null
  error: string | null
  signIn: (nickname: string) => Promise<void>
  signOut: () => void
  /** The rating after an attempt (the server already stored it). */
  setRating: (rating: number) => void
}

export function usePlayer(): PlayerView {
  const [player, setPlayer] = useState<Player | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signIn = useCallback(async (nickname: string) => {
    try {
      const signed = await api.signIn(nickname.trim())
      remember(signed.nickname)
      setPlayer(signed)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Signed in before in this browser: sign in again (the server keeps the rating).
  useEffect(() => {
    const nickname = stored()
    if (!nickname) return
    api.signIn(nickname).then(setPlayer, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const signOut = useCallback(() => {
    remember(null)
    setPlayer(null)
  }, [])

  const setRating = useCallback((rating: number) => setPlayer((p) => (p ? { ...p, rating, plays: p.plays + 1 } : p)), [])

  return { player, error, signIn, signOut, setRating }
}

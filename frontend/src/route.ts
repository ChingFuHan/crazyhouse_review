// Two pages, chosen by the URL hash (#/ review, #/puzzles and its tabs, #/puzzles/<id> for a given
// puzzle), so a link or a reload keeps the page.

import { useEffect, useState } from 'react'

export type Page = 'review' | 'puzzles'

const pageOf = (hash: string): Page => (hash.startsWith('#/puzzles') ? 'puzzles' : 'review')

export function usePage(): Page {
  const [page, setPage] = useState(() => pageOf(window.location.hash))
  useEffect(() => {
    const onChange = () => setPage(pageOf(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return page
}

export type PuzzleTab = 'solve' | 'library' | 'history'
export interface PuzzleRoute {
  tab: PuzzleTab
  /** The puzzle a link names (#/puzzles/<id>), or null. */
  id: number | null
}

const puzzleRouteOf = (hash: string): PuzzleRoute => {
  const match = /^#\/puzzles\/(\d+|library|history)$/.exec(hash)
  if (!match) return { tab: 'solve', id: null }
  return /^\d+$/.test(match[1]) ? { tab: 'solve', id: Number(match[1]) } : { tab: match[1] as PuzzleTab, id: null }
}

/** The puzzle page's tab and linked puzzle: #/puzzles, #/puzzles/<id>, #/puzzles/library, #/puzzles/history. */
export function usePuzzleRoute(): PuzzleRoute {
  const [route, setRoute] = useState(() => puzzleRouteOf(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(puzzleRouteOf(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const puzzleLink = (id: number) => `#/puzzles/${id}`
export const puzzleTabLink = (tab: PuzzleTab) => (tab === 'solve' ? '#/puzzles' : `#/puzzles/${tab}`)

export function goTo(page: Page) {
  window.location.hash = page === 'puzzles' ? '#/puzzles' : '#/'
}

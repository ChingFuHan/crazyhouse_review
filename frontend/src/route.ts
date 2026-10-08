// Two pages, chosen by the URL hash (#/ review, #/puzzles, #/puzzles/<id> for a given puzzle), so a
// link or a reload keeps the page.

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

const puzzleOf = (hash: string): number | null => {
  const match = /^#\/puzzles\/(\d+)$/.exec(hash)
  return match ? Number(match[1]) : null
}

/** The puzzle a link names (#/puzzles/<id>), or null. */
export function usePuzzleLink(): number | null {
  const [id, setId] = useState(() => puzzleOf(window.location.hash))
  useEffect(() => {
    const onChange = () => setId(puzzleOf(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return id
}

export const puzzleLink = (id: number) => `#/puzzles/${id}`

export function goTo(page: Page) {
  window.location.hash = page === 'puzzles' ? '#/puzzles' : '#/'
}

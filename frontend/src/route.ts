// Two pages, chosen by the URL hash (#/ review, #/puzzles), so a link or a reload keeps the page.

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

export function goTo(page: Page) {
  window.location.hash = page === 'puzzles' ? '#/puzzles' : '#/'
}

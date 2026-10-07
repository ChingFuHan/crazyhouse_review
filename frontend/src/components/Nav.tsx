import type { Page } from '../route'

export function Nav({ current }: { current: Page }) {
  return (
    <nav className="page-tabs" aria-label="頁面">
      <a href="#/" className={current === 'review' ? 'active' : ''} aria-current={current === 'review' ? 'page' : undefined}>
        復盤
      </a>
      <a
        href="#/puzzles"
        className={current === 'puzzles' ? 'active' : ''}
        aria-current={current === 'puzzles' ? 'page' : undefined}
      >
        題目
      </a>
    </nav>
  )
}

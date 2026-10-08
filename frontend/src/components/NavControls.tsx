import { useEffect } from 'react'
import { isTyping } from '../typing'
import type { NavKind } from '../useReview'

export interface NavControlsProps {
  onNavigate: (kind: NavKind) => void
  onFlip: () => void
}

const KEYS: Record<string, NavKind> = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last', ArrowUp: 'first', ArrowDown: 'last' }

export function NavControls({ onNavigate, onFlip }: NavControlsProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey) return
      const kind = KEYS[event.key]
      if (kind) {
        event.preventDefault()
        onNavigate(kind)
      } else if (event.key === 'f') {
        onFlip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNavigate, onFlip])

  return (
    <div className="nav-controls">
      <button aria-label="first" title="開頭 (Home)" onClick={() => onNavigate('first')}>⏮</button>
      <button aria-label="prev" title="上一步 (←)" onClick={() => onNavigate('prev')}>◀</button>
      <button aria-label="next" title="下一步 (→)" onClick={() => onNavigate('next')}>▶</button>
      <button aria-label="last" title="最後 (End)" onClick={() => onNavigate('last')}>⏭</button>
      <button aria-label="flip" title="翻轉棋盤 (f)" onClick={onFlip}>⇅</button>
    </div>
  )
}

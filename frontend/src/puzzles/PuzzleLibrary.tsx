import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiChoiceView } from '../aiChoice'
import { api } from '../api'
import { puzzleLink } from '../route'
import { PUZZLE_TYPE_NAMES, type PuzzleSource, type PuzzleSummary, type PuzzleType } from '../types'
import { PuzzleMaker } from './PuzzleMaker'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const SOURCES: Record<PuzzleSource, string> = { game: '對局', selfplay: '自我對弈', manual: '手動', design: 'AI 設計' }
type Sort = 'rating' | 'newest' | 'plays'
const SORTS: Record<Sort, (a: PuzzleSummary, b: PuzzleSummary) => number> = {
  rating: (a, b) => a.rating - b.rating,
  newest: (a, b) => b.id - a.id,
  plays: (a, b) => b.plays - a.plays,
}

/** The whole library: filter, open a puzzle, restore a reported one; then making new puzzles. */
export function PuzzleLibrary({ ai }: { ai: AiChoiceView }) {
  const [puzzles, setPuzzles] = useState<PuzzleSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<PuzzleType | 'all'>('all')
  const [source, setSource] = useState<PuzzleSource | 'all'>('all')
  const [byAi, setByAi] = useState(false)
  const [showReported, setShowReported] = useState(false)
  const [sort, setSort] = useState<Sort>('rating')

  const refresh = useCallback(() => {
    api.puzzleLibrary().then(setPuzzles, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(refresh, [refresh])

  const restore = async (id: number) => {
    try {
      await api.restorePuzzle(id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const shown = useMemo(
    () =>
      (puzzles ?? [])
        .filter((p) => (type === 'all' || p.type === type) && (source === 'all' || p.source === source))
        .filter((p) => (!byAi || p.ai) && (showReported ? p.disabled : !p.disabled))
        .sort(SORTS[sort]),
    [puzzles, type, source, byAi, showReported, sort],
  )
  const active = (puzzles ?? []).filter((p) => !p.disabled)
  const reported = (puzzles ?? []).length - active.length

  return (
    <div className="puzzle-library-tab">
      <section className="panel puzzle-library" data-testid="puzzle-library">
        <h2>題庫</h2>
        {puzzles && (
          <p data-testid="puzzle-stats">
            共 {active.length} 題：
            {TYPES.map((t) => `${PUZZLE_TYPE_NAMES[t]} ${active.filter((p) => p.type === t).length}`).join('、')}
            {reported > 0 && `（另有 ${reported} 題被回報停用）`}
          </p>
        )}
        <div className="library-filters" role="group" aria-label="篩選題目">
          <select aria-label="題型篩選" value={type} onChange={(e) => setType(e.target.value as PuzzleType | 'all')}>
            <option value="all">全部題型</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {PUZZLE_TYPE_NAMES[t]}
              </option>
            ))}
          </select>
          <select aria-label="來源篩選" value={source} onChange={(e) => setSource(e.target.value as PuzzleSource | 'all')}>
            <option value="all">全部來源</option>
            {Object.entries(SOURCES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="rating">依 rating</option>
            <option value="newest">最新</option>
            <option value="plays">最多人做</option>
          </select>
          <label className="toggle">
            <input type="checkbox" checked={byAi} onChange={(e) => setByAi(e.target.checked)} />
            AI 撰寫
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showReported} onChange={(e) => setShowReported(e.target.checked)} />
            被回報的
          </label>
        </div>
        {error && <div className="engine-error">{error}</div>}
        {puzzles && shown.length === 0 && <p className="muted">沒有符合的題目。</p>}
        <ul className="library-list" data-testid="library-list">
          {shown.map((p) => (
            <li key={p.id} className={p.disabled ? 'disabled' : undefined}>
              <a href={puzzleLink(p.id)}>
                #{p.id} {p.type_name}
                {p.title ? `・${p.title}` : ''}
              </a>
              <span className="muted">
                {' '}
                rating {p.rating} · {SOURCES[p.source] ?? p.source}
                {p.plays > 0 ? ` · ${p.plays} 次、解出 ${Math.round((p.wins / p.plays) * 100)}%` : ' · 還沒有人做過'}
                {p.ai ? ` · ${p.ai}` : ''}
              </span>
              {p.disabled && (
                <span className="library-report">
                  {' '}
                  回報：{p.report}{' '}
                  <button onClick={() => void restore(p.id)}>恢復</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <PuzzleMaker ai={ai} onChanged={refresh} />
    </div>
  )
}

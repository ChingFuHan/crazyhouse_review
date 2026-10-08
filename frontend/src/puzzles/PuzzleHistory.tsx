import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { puzzleLink } from '../route'
import { PUZZLE_TYPE_NAMES, type PlayerHistory, type PuzzleType } from '../types'
import { ratingPoints, ratingScale } from './ratingGraph'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const HEIGHT = 140
const AXIS = 40 // room for the rating ticks on the left
const PAD = 10 // above the top tick and below the bottom one, so their labels are not cut
const RESULTS: Record<string, string> = { '1': '解出', '0.5': '半分', '0': '失敗' }
const date = (at: number) =>
  new Date(at * 1000).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type Attempt = PlayerHistory['attempts'][number]

/** The player's rating after each rated attempt; hover (or arrow keys) for the attempt. */
function RatingGraph({ attempts }: { attempts: Attempt[] }) {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const oldestFirst = useMemo(() => [...attempts].reverse(), [attempts])
  const start = oldestFirst[0].before
  const afters = oldestFirst.map((a) => a.after)
  const scale = useMemo(() => ratingScale([start, ...afters]), [start, afters])
  const plot = Math.max(0, width - AXIS - 8)
  const points = ratingPoints(start, afters, plot, HEIGHT, scale).map((p) => ({ ...p, x: p.x + AXIS, y: p.y + PAD }))
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
  const y = (rating: number) => PAD + HEIGHT - ((rating - scale.min) / (scale.max - scale.min)) * HEIGHT
  const shown = hover !== null ? points[hover] : null
  const last = points.at(-1)!

  const nearest = (clientX: number) => {
    const x = clientX - host.current!.getBoundingClientRect().left
    return points.reduce((best, p, i) => (Math.abs(p.x - x) < Math.abs(points[best].x - x) ? i : best), 0)
  }

  return (
    <div
      ref={host}
      className="rating-graph"
      data-testid="rating-graph"
      tabIndex={0}
      aria-label={`rating 變化：從 ${start} 到 ${last.rating}（下方列表有每一題）`}
      onPointerMove={(e) => setHover(nearest(e.clientX))}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const from = hover ?? points.length - 1
        setHover(Math.max(0, Math.min(points.length - 1, from + (e.key === 'ArrowLeft' ? -1 : 1))))
      }}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT + 2 * PAD} aria-hidden>
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={AXIS} x2={width} y1={y(tick)} y2={y(tick)} className="rating-grid" />
              <text x={AXIS - 6} y={y(tick)} className="rating-tick" textAnchor="end" dominantBaseline="middle">
                {tick}
              </text>
            </g>
          ))}
          {shown && <line x1={shown.x} x2={shown.x} y1={PAD} y2={PAD + HEIGHT} className="rating-crosshair" />}
          <path d={path} className="rating-line" />
          {(shown ? [shown] : [last]).map((p) => (
            <circle key={p.attempt} cx={p.x} cy={p.y} r={4} className="rating-dot" />
          ))}
        </svg>
      )}
      {shown && (
        <div className="rating-tooltip" style={{ left: Math.min(Math.max(shown.x - 70, 0), Math.max(0, width - 150)) }}>
          <strong>{shown.rating}</strong>
          <span>
            {shown.attempt < 0
              ? '開始'
              : `#${oldestFirst[shown.attempt].puzzle.id} ${oldestFirst[shown.attempt].puzzle.type_name} · ${
                  RESULTS[String(oldestFirst[shown.attempt].score)]
                } · ${date(oldestFirst[shown.attempt].at)}`}
          </span>
        </div>
      )}
    </div>
  )
}

/** The signed-in player's record: rating over time, results by kind, the latest attempts. */
export function PuzzleHistory({ nickname }: { nickname: string | null }) {
  const [history, setHistory] = useState<PlayerHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!nickname) return
    let live = true
    api.playerHistory(nickname).then(
      (h) => live && setHistory(h),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [nickname])

  if (!nickname) return <section className="panel puzzle-history">登入後就能看到自己的紀錄。</section>
  if (error) return <section className="panel puzzle-history engine-error">{error}</section>
  if (!history) return <section className="panel puzzle-history">載入中…</section>
  const { player, attempts, by_type } = history
  const solved = attempts.filter((a) => a.score === 1).length

  return (
    <section className="panel puzzle-history" data-testid="puzzle-history">
      <h2>我的紀錄</h2>
      <div className="history-figures">
        <div>
          <span className="muted">目前 rating</span>
          <strong className="history-hero">{Math.round(player.rating)}</strong>
        </div>
        <div>
          <span className="muted">計分作答</span>
          <strong>{attempts.length}</strong>
        </div>
        <div>
          <span className="muted">完全解出</span>
          <strong>{attempts.length ? `${Math.round((solved / attempts.length) * 100)}%` : '—'}</strong>
        </div>
      </div>
      {attempts.length === 0 ? (
        <p className="muted">還沒有計分的作答：到「解題」做第一題吧。</p>
      ) : (
        <>
          <h3>rating 變化</h3>
          <RatingGraph attempts={attempts} />
          <h3>各題型</h3>
          <table className="history-types" data-testid="history-types">
            <thead>
              <tr>
                <th>題型</th>
                <th>次數</th>
                <th>平均得分</th>
              </tr>
            </thead>
            <tbody>
              {TYPES.filter((t) => by_type[t]).map((t) => (
                <tr key={t}>
                  <td>{PUZZLE_TYPE_NAMES[t]}</td>
                  <td>{by_type[t]!.plays}</td>
                  <td>{Math.round(by_type[t]!.score * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>最近作答</h3>
          <ol className="history-list" data-testid="history-list">
            {attempts.map((a) => (
              <li key={`${a.puzzle.id}:${a.at}`}>
                <span className="muted">{date(a.at)}</span>{' '}
                <a href={puzzleLink(a.puzzle.id)}>
                  #{a.puzzle.id} {a.puzzle.type_name}
                  {a.puzzle.title ? `・${a.puzzle.title}` : ''}
                </a>{' '}
                <span className={`history-result score-${String(a.score).replace('.', '-')}`}>{RESULTS[String(a.score)] ?? a.score}</span>{' '}
                <span className="muted">
                  {a.before} → {a.after}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

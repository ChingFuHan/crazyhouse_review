import { useEffect, useMemo, useRef, useState } from 'react'
import { formatScore } from '../evaluation'
import { graphPoints, nearest } from '../evalGraph'
import { GLYPH, LABEL } from '../reviewText'
import type { GameTree } from '../tree'
import type { ReviewJob } from '../types'

const HEIGHT = 96

export interface EvalGraphProps {
  tree: GameTree
  job: ReviewJob
  activeId: string
  onSelect: (id: string) => void
}

function moveLabel(tree: GameTree, positionId: string): string {
  const node = tree.nodes[positionId]
  const move = node?.state.last_move
  if (!node || !move) return '開局'
  const blackMoved = node.state.side_to_move === 'white'
  return `${blackMoved ? node.state.move_number - 1 : node.state.move_number}${blackMoved ? '…' : '.'}${move.san}`
}

/** White's winning chances along the reviewed main line. Click to jump to a move. */
export function EvalGraph({ tree, job, activeId, onSelect }: EvalGraphProps) {
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

  const lastId = job.plies.at(-1)?.position_id
  const winner = lastId && job.status === 'done' ? (tree.nodes[lastId]?.state.outcome?.winner ?? null) : null
  const points = useMemo(() => graphPoints(job.plies, job.total, width, HEIGHT, winner), [job, width, winner])
  const byPly = useMemo(() => new Map(job.plies.map((p) => [p.ply, p])), [job])
  const mid = HEIGHT / 2
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
  const area = points.length ? `${path}L${points.at(-1)!.x.toFixed(1)},${mid}L${points[0].x.toFixed(1)},${mid}Z` : ''
  const active = points.find((p) => p.positionId === activeId)
  const hovered = hover !== null ? points[hover] : null
  const hoveredPly = hovered ? byPly.get(hovered.ply) : undefined

  const pick = (clientX: number) => {
    const box = host.current!.getBoundingClientRect()
    return points.length ? nearest(points, clientX - box.left) : null
  }

  return (
    <div
      ref={host}
      className="eval-graph"
      data-testid="eval-graph"
      tabIndex={0}
      aria-label="主線評估曲線（白方勝率，上方對白方有利）"
      onPointerMove={(e) => setHover(pick(e.clientX))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const index = pick(e.clientX)
        if (index !== null && tree.nodes[points[index].positionId]) onSelect(points[index].positionId)
      }}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-hidden>
          <defs>
            <clipPath id="eval-top">
              <rect x={0} y={0} width={width} height={mid} />
            </clipPath>
            <clipPath id="eval-bottom">
              <rect x={0} y={mid} width={width} height={mid} />
            </clipPath>
          </defs>
          <path d={area} className="eval-area-white" clipPath="url(#eval-top)" />
          <path d={area} className="eval-area-black" clipPath="url(#eval-bottom)" />
          <line x1={0} x2={width} y1={mid} y2={mid} className="eval-midline" />
          {active && <line x1={active.x} x2={active.x} y1={0} y2={HEIGHT} className="eval-active" />}
          {hovered && <line x1={hovered.x} x2={hovered.x} y1={0} y2={HEIGHT} className="eval-crosshair" />}
          <path d={path} className="eval-line" />
          {points.map((p) => {
            const classification = byPly.get(p.ply)?.classification
            return classification ? (
              <circle key={p.ply} cx={p.x} cy={p.y} r={4} className={`eval-dot ${classification}`} data-ply={p.ply} />
            ) : null
          })}
        </svg>
      )}
      {hovered && hoveredPly && (
        <div className="eval-tooltip" style={{ left: Math.min(Math.max(hovered.x, 70), width - 70) }} data-testid="eval-tooltip">
          <strong>{hoveredPly.evaluation !== null || hoveredPly.mate !== null ? formatScore(hoveredPly) : '終局'}</strong>
          <span>
            {moveLabel(tree, hovered.positionId)}
            {hoveredPly.classification && ` ${GLYPH[hoveredPly.classification]} ${LABEL[hoveredPly.classification]}`}
          </span>
        </div>
      )}
    </div>
  )
}

// Eval graph geometry for the reviewed main line. White's winning chances in [-1, 1]
// (same curve and crazyhouse scale as the backend review), mapped to pixels.

import type { Color, ReviewPly } from './types'

const CRAZYHOUSE_CP_SCALE = 0.5 // keep in sync with backend/app/review.py

export function whiteChances(ply: Pick<ReviewPly, 'evaluation' | 'mate'>): number | null {
  if (ply.mate !== null) return ply.mate > 0 ? 1 : -1
  if (ply.evaluation === null) return null
  const cp = ply.evaluation * 100 * CRAZYHOUSE_CP_SCALE
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
}

export interface GraphPoint {
  ply: number
  positionId: string
  x: number
  y: number
  value: number
}

/** Points for plies that have a value; a mated final position counts as ±1 for the winner. */
export function graphPoints(
  plies: ReviewPly[],
  total: number,
  width: number,
  height: number,
  winnerAtEnd: Color | null,
): GraphPoint[] {
  const span = Math.max(1, total - 1)
  const mid = height / 2
  return plies.flatMap((ply) => {
    let value = whiteChances(ply)
    if (value === null && ply.ply === total - 1 && winnerAtEnd) value = winnerAtEnd === 'white' ? 1 : -1
    if (value === null) return []
    return [{ ply: ply.ply, positionId: ply.position_id, x: (ply.ply / span) * width, y: mid - value * mid, value }]
  })
}

/** Index of the point whose x is nearest to `x`. */
export function nearest(points: GraphPoint[], x: number): number {
  let best = 0
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i
  }
  return best
}

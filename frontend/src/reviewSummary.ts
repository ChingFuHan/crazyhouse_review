// Whole-game review summary per side: accuracy (lichess's per-move formula on winning chances) and
// how many moves of each kind of error.

import { whiteChances } from './evalGraph'
import type { Color, MoveClassification, ReviewPly } from './types'

export interface SideSummary {
  /** Average move accuracy in %, or null when no move could be scored. */
  accuracy: number | null
  counts: Partial<Record<MoveClassification, number>>
}

/** Accuracy of one move from the mover's winning chances (-1..1) before and after it, as on lichess. */
export function moveAccuracy(before: number, after: number): number {
  const drop = Math.max(0, (before - after) * 50) // in winning-percentage points
  return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669))
}

/** The side that played the move leading to ply `ply`, when `rootSide` moves first. */
export const moverOf = (ply: number, rootSide: Color): Color => ((ply % 2 === 1) === (rootSide === 'white') ? 'white' : 'black')

export function summarize(plies: ReviewPly[], rootSide: Color): Record<Color, SideSummary> {
  const scores: Record<Color, number[]> = { white: [], black: [] }
  const counts: Record<Color, Partial<Record<MoveClassification, number>>> = { white: {}, black: {} }
  const byPly = new Map(plies.map((p) => [p.ply, p]))
  for (const ply of plies) {
    if (ply.ply === 0) continue
    const mover = moverOf(ply.ply, rootSide)
    if (ply.classification) counts[mover][ply.classification] = (counts[mover][ply.classification] ?? 0) + 1
    const previous = byPly.get(ply.ply - 1)
    const before = previous ? whiteChances(previous) : null
    const after = whiteChances(ply)
    if (before === null || after === null) continue
    const sign = mover === 'white' ? 1 : -1
    scores[mover].push(moveAccuracy(before * sign, after * sign))
  }
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)
  return {
    white: { accuracy: average(scores.white), counts: counts.white },
    black: { accuracy: average(scores.black), counts: counts.black },
  }
}

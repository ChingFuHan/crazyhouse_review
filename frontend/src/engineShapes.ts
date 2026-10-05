import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { roleOf } from './pieces'
import type { Color, EngineAnalysis } from './types'

const BRUSHES = ['paleBlue', 'paleGrey', 'paleGrey']

/** Arrows for board moves; a ghost piece + circle on the target square for drops. */
export function engineShapes(analysis: EngineAnalysis | null, sideToMove: Color): DrawShape[] {
  if (!analysis) return []
  return analysis.lines.slice(0, 3).flatMap((line, index): DrawShape[] => {
    const move = line.pv[0]
    const brush = BRUSHES[index]
    const lineWidth = index === 0 ? 12 : 6
    if (move.drop) {
      return [
        { orig: move.to as Key, brush, modifiers: { lineWidth } },
        { orig: move.to as Key, brush, piece: { role: roleOf(move.drop), color: sideToMove, scale: 0.7 } },
      ]
    }
    return [{ orig: move.from as Key, dest: move.to as Key, brush, modifiers: { lineWidth } }]
  })
}

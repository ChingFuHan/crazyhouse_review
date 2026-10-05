import { describe, expect, it } from 'vitest'
import { graphPoints, nearest, whiteChances } from './evalGraph'
import type { ReviewPly } from './types'

const ply = (n: number, evaluation: number | null, mate: number | null = null): ReviewPly => ({
  ply: n,
  position_id: `p${n}`,
  evaluation,
  mate,
  evaluation_pov: 'white',
  best_move: null,
  best_before: null,
  played_best: null,
  played_evaluation: null,
  played_mate: null,
  classification: null,
})

describe('eval graph', () => {
  it('maps White-POV scores to winning chances', () => {
    expect(whiteChances({ evaluation: 0, mate: null })).toBe(0)
    expect(whiteChances({ evaluation: null, mate: -3 })).toBe(-1)
    expect(whiteChances({ evaluation: 4, mate: null })).toBeCloseTo(-whiteChances({ evaluation: -4, mate: null })!)
    expect(whiteChances({ evaluation: null, mate: null })).toBeNull()
  })

  it('places points across the width with White up', () => {
    const points = graphPoints([ply(0, 0), ply(1, 10), ply(2, null, -2)], 3, 200, 100, null)
    expect(points.map((p) => [p.x, Math.round(p.y)])).toEqual([[0, 50], [100, Math.round(50 - whiteChances({ evaluation: 10, mate: null })! * 50)], [200, 100]])
  })

  it('counts a final checkmate for the winner and skips unknown values', () => {
    const points = graphPoints([ply(0, 0), ply(1, null), ply(2, null)], 3, 100, 100, 'white')
    expect(points.map((p) => p.ply)).toEqual([0, 2])
    expect(points[1].value).toBe(1)
  })

  it('finds the nearest point', () => {
    const points = graphPoints([ply(0, 0), ply(1, 0), ply(2, 0)], 3, 200, 100, null)
    expect(nearest(points, 130)).toBe(1)
    expect(nearest(points, 180)).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import { moveAccuracy, moverOf, summarize } from './reviewSummary'
import type { ReviewPly } from './types'

const ply = (n: number, evaluation: number | null, classification: ReviewPly['classification'] = null): ReviewPly => ({
  ply: n,
  position_id: `p${n}`,
  evaluation,
  mate: null,
  evaluation_pov: 'white',
  best_move: null,
  best_before: null,
  played_best: null,
  played_evaluation: null,
  played_mate: null,
  classification,
})

describe('review summary', () => {
  it('scores a move by the winning chances it gave away', () => {
    expect(moveAccuracy(0.2, 0.2)).toBeCloseTo(100, 2)
    expect(moveAccuracy(0.2, 0.5)).toBeCloseTo(100, 2) // gaining is never penalised
    expect(moveAccuracy(0.6, -0.6)).toBeLessThan(10) // a blunder
    expect(moveAccuracy(0.1, 0.0)).toBeGreaterThan(75)
  })

  it('knows who moved, also when black starts', () => {
    expect([1, 2, 3].map((n) => moverOf(n, 'white'))).toEqual(['white', 'black', 'white'])
    expect([1, 2].map((n) => moverOf(n, 'black'))).toEqual(['black', 'white'])
  })

  it('averages each side and counts its errors', () => {
    const plies = [ply(0, 0.2), ply(1, 0.3), ply(2, 12.0, 'blunder'), ply(3, 12.1), ply(4, null)]
    const summary = summarize(plies, 'white')
    expect(summary.black.counts).toEqual({ blunder: 1 })
    expect(summary.white.counts).toEqual({})
    expect(summary.black.accuracy!).toBeLessThan(20)
    expect(summary.white.accuracy!).toBeGreaterThan(95)
    expect(summarize([ply(0, 0)], 'white').white.accuracy).toBeNull()
  })
})

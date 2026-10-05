import { describe, expect, it } from 'vitest'
import { reviewNote } from './reviewText'
import type { ReviewPly } from './types'

const ply = (over: Partial<ReviewPly>): ReviewPly => ({
  ply: 1,
  position_id: 'p',
  evaluation: null,
  mate: null,
  evaluation_pov: 'white',
  best_move: null,
  best_before: null,
  played_best: false,
  played_evaluation: null,
  played_mate: null,
  classification: null,
  ...over,
})

describe('reviewNote', () => {
  it('compares best and played scores from the same position', () => {
    const before = ply({ ply: 22, evaluation: 4.94 })
    const after = ply({ ply: 23, classification: 'blunder', best_before: 'B@b4+', played_evaluation: -3.67, evaluation: -3.73 })
    expect(reviewNote(after, before)).toBe('大錯：最佳 B@b4+ +4.94，實戰 -3.67（白方視角）')
  })

  it('handles mates and unflagged moves', () => {
    const before = ply({ mate: 3 })
    expect(reviewNote(ply({ classification: 'mate_missed', best_before: 'Qxc7+', played_evaluation: 9.5 }), before)).toBe(
      '錯過強制將殺：最佳 Qxc7+ #3，實戰 +9.50（白方視角）',
    )
    expect(reviewNote(ply({}), before)).toBe('')
  })
})

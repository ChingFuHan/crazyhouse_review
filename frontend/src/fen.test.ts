import { describe, expect, it } from 'vitest'
import { looksLikeFen } from './useReview'

describe('looksLikeFen', () => {
  it('accepts crazyhouse FEN in bracket and slash pocket styles', () => {
    expect(looksLikeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1')).toBe(true)
    expect(looksLikeFen('  r1bq1rk1/p1p1bppp/2pp1n1P/4p3/3Q4/1P2PN2/PBP2PPP/RN2K2R/Nb w KQ - 0 1 \n')).toBe(true)
    expect(looksLikeFen('6k1/5ppp/8/8/8/8/5PPP/6K1[R] b - - 0 1')).toBe(true)
  })

  it('rejects PGN text', () => {
    expect(looksLikeFen('[Variant "Crazyhouse"]\n\n1. e4 e5 *')).toBe(false)
    expect(looksLikeFen('1. e4 Nf6 2. Nc3 *')).toBe(false)
    expect(looksLikeFen('[FEN "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"]')).toBe(false)
  })
})

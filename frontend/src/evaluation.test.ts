import { describe, expect, it } from 'vitest'
import { formatScore, scoreOwner, whiteShare } from './evaluation'

describe('evaluation formatting (White POV)', () => {
  it('formats centipawn and mate scores', () => {
    expect(formatScore({ evaluation: 1.234, mate: null })).toBe('+1.23')
    expect(formatScore({ evaluation: -0.5, mate: null })).toBe('-0.50')
    expect(formatScore({ evaluation: 0, mate: null })).toBe('0.00')
    expect(formatScore({ evaluation: null, mate: 3 })).toBe('#3')
    expect(formatScore({ evaluation: null, mate: -2 })).toBe('#-2')
  })

  it('maps scores onto the eval bar', () => {
    expect(whiteShare({ evaluation: 0, mate: null })).toBe(0.5)
    expect(whiteShare({ evaluation: null, mate: -1 })).toBe(0)
    expect(whiteShare({ evaluation: null, mate: 4 })).toBe(1)
    expect(whiteShare({ evaluation: 6, mate: null })).toBeGreaterThan(0.8)
  })

  it('names the favoured side', () => {
    expect(scoreOwner({ evaluation: -3.8, mate: null })).toBe('黑方優勢')
    expect(scoreOwner({ evaluation: 0.2, mate: null })).toBe('均勢')
    expect(scoreOwner({ evaluation: null, mate: -5 })).toBe('黑方可強制將死')
  })
})

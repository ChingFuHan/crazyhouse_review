import { describe, expect, it } from 'vitest'
import { boardDests, dropSquares, promotionChoices } from './moves'

const legal = ['e2e4', 'e2e3', 'g1f3', 'N@d6', 'N@e5', 'P@e3', 'b7a8q', 'b7a8r', 'b7a8b', 'b7a8n', 'b7b8q', 'b7b8r', 'b7b8b', 'b7b8n']

describe('moves', () => {
  it('builds board dests without drops and without duplicate promotion targets', () => {
    const dests = boardDests(legal)
    expect(dests.get('e2')).toEqual(['e4', 'e3'])
    expect(dests.get('b7')).toEqual(['a8', 'b8'])
    expect([...dests.keys()]).not.toContain('N@')
  })

  it('lists drop squares per piece', () => {
    expect(dropSquares(legal, 'N')).toEqual(['d6', 'e5'])
    expect(dropSquares(legal, 'p')).toEqual(['e3'])
    expect(dropSquares(legal, 'Q')).toEqual([])
  })

  it('lists promotion choices only for promotion moves', () => {
    expect(promotionChoices(legal, 'b7', 'a8')).toEqual(['Q', 'R', 'B', 'N'])
    expect(promotionChoices(legal, 'e2', 'e4')).toEqual([])
  })
})

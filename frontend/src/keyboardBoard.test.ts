import { describe, expect, it } from 'vitest'
import { initialCursor, moveCursor } from './keyboardBoard'

describe('keyboard cursor', () => {
  it('moves as seen on the board for both orientations and stays on the board', () => {
    expect(moveCursor('e2', 'up', 'white')).toBe('e3')
    expect(moveCursor('e2', 'right', 'white')).toBe('f2')
    expect(moveCursor('e7', 'up', 'black')).toBe('e6')
    expect(moveCursor('e7', 'right', 'black')).toBe('d7')
    expect(moveCursor('h8', 'up', 'white')).toBe('h8')
    expect(moveCursor('a1', 'left', 'white')).toBe('a1')
    expect(initialCursor('black')).toBe('e7')
  })
})

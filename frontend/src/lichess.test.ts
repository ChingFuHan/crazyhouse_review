import { describe, expect, it } from 'vitest'
import { gameIdOf, parseGames } from './lichess'

describe('lichess', () => {
  it('finds the game id in urls and bare ids', () => {
    expect(gameIdOf('https://lichess.org/q7ZvsdUF')).toBe('q7ZvsdUF')
    expect(gameIdOf('lichess.org/q7ZvsdUFxyz1/black#12')).toBe('q7ZvsdUF')
    expect(gameIdOf('https://lichess.org/q7ZvsdUF?ply=3')).toBe('q7ZvsdUF')
    expect(gameIdOf(' q7ZvsdUF ')).toBe('q7ZvsdUF')
    expect(gameIdOf('https://lichess.org/@/someone')).toBeNull()
    expect(gameIdOf('1. e4 e5')).toBeNull()
  })

  it('reads the ndjson game list, skipping broken lines', () => {
    const games = parseGames(
      [
        JSON.stringify({ id: 'abcdefgh', players: { white: { user: { name: 'Ann' }, rating: 1800 }, black: { aiLevel: 3 } }, winner: 'white', status: 'mate', createdAt: 1, opening: { name: 'Italian Game' }, clock: { initial: 180, increment: 2 } }),
        'not json',
        JSON.stringify({ id: 'hgfedcba', players: { white: {}, black: { user: { name: 'Bo' } } }, status: 'draw', createdAt: 2 }),
      ].join('\n'),
    )
    expect(games).toEqual([
      { id: 'abcdefgh', white: { name: 'Ann', rating: 1800 }, black: { name: 'Stockfish level 3', rating: null }, winner: 'white', status: 'mate', createdAt: 1, opening: 'Italian Game', clock: '3+2' },
      { id: 'hgfedcba', white: { name: '匿名', rating: null }, black: { name: 'Bo', rating: null }, winner: null, status: 'draw', createdAt: 2, opening: null, clock: null },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { gameIdOf, lichessAnalysisUrl, parseGames } from './lichess'

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

describe('lichess analysis board', () => {
  it('writes the pocket as a ninth rank and keeps the side to view from', () => {
    expect(lichessAnalysisUrl('6k1/5ppp/8/8/8/8/5PPP/6K1[Rp] w - - 0 1', 'white')).toBe(
      'https://lichess.org/analysis/crazyhouse/6k1/5ppp/8/8/8/8/5PPP/6K1/Rp_w_-_-_0_1',
    )
    expect(lichessAnalysisUrl('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] b KQkq - 0 1', 'black')).toBe(
      'https://lichess.org/analysis/crazyhouse/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR/_b_KQkq_-_0_1?color=black',
    )
  })
})

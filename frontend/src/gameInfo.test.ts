import { describe, expect, it } from 'vitest'
import { gameDate, lichessUrl, timeControl } from './gameInfo'

describe('game info', () => {
  it('writes time controls the way players say them', () => {
    expect(timeControl('180+2')).toBe('3+2')
    expect(timeControl('30+0')).toBe('30 秒+0')
    expect(timeControl('-')).toBe('不限時')
    expect(timeControl(undefined)).toBeNull()
    expect(timeControl('40/7200')).toBe('40/7200')
  })

  it('finds the lichess game and the date', () => {
    expect(lichessUrl('https://lichess.org/q7ZvsdUF')).toBe('https://lichess.org/q7ZvsdUF')
    expect(lichessUrl('https://example.com/x')).toBeNull()
    expect(gameDate({ UTCDate: '2026.10.08', Date: '????.??.??' })).toBe('2026-10-08')
    expect(gameDate({ Date: '????.??.??' })).toBeNull()
  })
})

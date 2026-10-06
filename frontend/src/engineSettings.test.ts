import { describe as suite, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, describe, sanitize, settingsKey } from './engineSettings'

suite('engine settings', () => {
  it('keeps offered values and replaces anything else with defaults', () => {
    expect(sanitize({ multipv: 5, depth: 30, movetime_ms: null, threads: 7, hash_mb: 4096 })).toEqual({
      multipv: 5,
      depth: 30,
      movetime_ms: null,
      threads: 7,
      hash_mb: 4096,
    })
    expect(sanitize({ multipv: 9, depth: 17, movetime_ms: -1, threads: 64, hash_mb: 99999 })).toEqual(DEFAULT_SETTINGS)
    expect(sanitize('garbage')).toEqual(DEFAULT_SETTINGS)
  })

  it('describes settings for the UI and keys them', () => {
    expect(describe.time(null)).toBe('無限')
    expect(describe.time(30_000)).toBe('30 秒')
    expect(describe.depth(null)).toBe('不限')
    expect(describe.hash(2048)).toBe('2 GB')
    expect(describe.nps(1_530_000)).toBe('1.5 M/s')
    expect(settingsKey(DEFAULT_SETTINGS)).toBe('3/-/3000/4/256')
  })
})

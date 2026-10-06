import { describe, expect, it } from 'vitest'
import type { EngineAnalysis } from './types'
import { nextMilestone } from './useEngine'

const snap = (depth: number) => ({ analysis_id: `d${depth}`, depth }) as EngineAnalysis

describe('nextMilestone', () => {
  it('keeps the first snapshot reaching each depth step from 10 on', () => {
    let milestone: EngineAnalysis | null = null
    const seen: (string | null)[] = []
    for (const depth of [4, 9, 10, 11, 14, 15, 15, 19, 22]) {
      milestone = nextMilestone(milestone, snap(depth))
      seen.push(milestone?.analysis_id ?? null)
    }
    expect(seen).toEqual([null, null, 'd10', 'd10', 'd10', 'd15', 'd15', 'd15', 'd22'])
  })
})

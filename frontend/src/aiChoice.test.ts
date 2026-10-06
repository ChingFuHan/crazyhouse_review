import { describe, expect, it } from 'vitest'
import { describeChoice, effortsFor, sanitizeChoice } from './aiChoice'
import type { LlmCatalog } from './types'

const CATALOG: LlmCatalog = {
  default: 'agy:gemini-3.8-flash-high',
  default_reason: null,
  providers: [
    {
      id: 'codex', label: 'Codex CLI', available: true, reason: null, efforts: ['low', 'medium', 'high'],
      models: [{ id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium'], default_effort: 'medium' }],
    },
    { id: 'claude', label: 'Claude CLI', available: false, reason: '找不到 claude', efforts: [], models: [] },
  ],
}

describe('AI choice against the live catalog', () => {
  it('keeps what the CLI still offers and resets what it dropped', () => {
    const ok = { provider: 'codex' as const, model: 'gpt-6-luna', effort: 'medium' }
    expect(sanitizeChoice(ok, CATALOG)).toEqual({ choice: ok, dropped: null })
    expect(sanitizeChoice({ ...ok, model: 'gpt-5' }, CATALOG)).toEqual({
      choice: { provider: 'codex', model: null, effort: null },
      dropped: 'model「gpt-5」已不提供',
    })
    expect(sanitizeChoice({ ...ok, effort: 'high' }, CATALOG).dropped).toBe('effort「high」已不提供') // per-model levels
    expect(sanitizeChoice({ provider: 'claude', model: null, effort: null }, CATALOG)).toEqual({
      choice: null,
      dropped: 'Claude CLI 目前無法使用',
    })
    expect(sanitizeChoice(null, CATALOG)).toEqual({ choice: null, dropped: null })
  })

  it("offers the model's own effort levels, else the CLI's", () => {
    expect(effortsFor(CATALOG.providers[0], 'gpt-6-luna')).toEqual(['low', 'medium'])
    expect(effortsFor(CATALOG.providers[0], null)).toEqual(['low', 'medium', 'high'])
  })

  it('describes the choice for the panels', () => {
    expect(describeChoice(null, CATALOG)).toBe('伺服器預設（agy:gemini-3.8-flash-high）')
    expect(describeChoice({ provider: 'codex', model: 'gpt-6-luna', effort: 'low' }, CATALOG)).toBe('Codex CLI · gpt-6-luna · effort low')
    expect(describeChoice({ provider: 'codex', model: null, effort: null }, CATALOG)).toBe('Codex CLI · CLI 預設 model')
  })
})

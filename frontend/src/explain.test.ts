import { describe, expect, it } from 'vitest'
import {
  comparison,
  directEffects,
  explain,
  kingSafety,
  moverValue,
  positionAlerts,
  pvText,
  replies,
  threatText,
} from './explain'
import type { CandidateFacts, Insights, MoveFacts, SideFacts } from './types'

function move(over: Partial<MoveFacts> & { san: string; uci: string }): MoveFacts {
  const { san, uci, ...rest } = over
  const drop = uci[1] === '@' ? uci[0] : null
  return {
    move: { uci, san, from: drop ? null : uci.slice(0, 2), to: uci.slice(2, 4).replace('@', '') || uci.slice(2), drop, promotion: null, is_capture: false },
    mover: 'white',
    is_check: false,
    is_mate: false,
    is_capture: false,
    captured: null,
    is_drop: drop !== null,
    is_promotion: false,
    discovered_check: false,
    attacks: [],
    opponent_king_escape_before: ['f8', 'h8'],
    opponent_king_escape_after: ['f8', 'h8'],
    pocket_before: [],
    pocket_after: [],
    opponent_reply_count: 20,
    forced_replies: [],
    discovered_attacks: [],
    blocked_lines: [],
    opened_file: null,
    threatens_mate: [],
    en_prise_to: [],
    tags: [],
    ...rest,
  }
}

const side = (color: 'white' | 'black'): SideFacts => ({
  color,
  king_square: color === 'white' ? 'g1' : 'g8',
  king_escape_squares: [],
  king_zone_attacks: 0,
  pocket: [],
  hanging_pieces: [],
  attacked_queens_rooks: [],
  drop_check_squares: {},
  king_zone_attackers: [],
  board_material: {},
})

const dropMate = move({
  san: 'R@e8#',
  uci: 'R@e8',
  is_check: true,
  is_mate: true,
  opponent_king_escape_after: [],
  opponent_reply_count: 0,
  pocket_before: ['R'],
  tags: ['drop', 'drop_mate', 'escape_square_reduction'],
})

const candidate = (rank: number, facts: MoveFacts, evaluation: number | null, mate: number | null): CandidateFacts => ({
  rank,
  evaluation,
  mate,
  evaluation_pov: 'white',
  depth: 12,
  facts,
  pv: [{ san: facts.move.san, uci: facts.move.uci, color: 'white', is_check: facts.is_check, is_drop: facts.is_drop }],
  forcing_checks: facts.is_check ? 1 : 0,
})

describe('explain', () => {
  it('describes a drop mate from facts only', () => {
    expect(directEffects(dropMate)).toEqual(['從 pocket 打入車到 e8，直接將死。'])
    expect(kingSafety(dropMate)).toBe('黑方王可走格 2 → 0（f8, h8 → 無）。')
    expect(replies(dropMate)).toBe('對手沒有合法回應。')
  })

  it('marks a captured promoted piece as a pawn for the pocket', () => {
    const f = move({ san: 'Nxa8', uci: 'b6a8', mover: 'black', is_capture: true, captured: 'Q~' })
    expect(directEffects(f)[0]).toContain('pocket 只得到兵')
  })

  it('compares candidates from the mover point of view', () => {
    const quiet = move({ san: 'Qh5', uci: 'd1h5' })
    const best = candidate(1, dropMate, null, 1)
    expect(comparison(best, candidate(2, quiet, 2.3, null), 'white')).toBe('最佳著可強制將死（#1），Qh5 不行；R@e8# 將軍，Qh5 不將軍。')
    // Black to move: White-POV -3.0 is better for black than -1.0.
    const a = candidate(1, move({ san: 'Qxe2', uci: 'd1e2', mover: 'black' }), -3, null)
    const b = candidate(2, move({ san: 'Nf6', uci: 'g8f6', mover: 'black' }), -1, null)
    expect(moverValue(a, 'black')).toBeGreaterThan(moverValue(b, 'black'))
    expect(comparison(a, b, 'black')).toBe('比最佳著少 2.00（黑方視角）。')
  })

  it('numbers the PV from the current move', () => {
    const pv = [
      { san: 'Kd7', uci: 'e8d7', color: 'black' as const, is_check: false, is_drop: false },
      { san: 'Nd2', uci: 'b1d2', color: 'white' as const, is_check: false, is_drop: false },
      { san: 'Nc6', uci: 'b8c6', color: 'black' as const, is_check: false, is_drop: false },
    ]
    expect(pvText(pv, 8)).toBe('8…Kd7 9.Nd2 Nc6')
  })

  it('builds the full explanation and alerts', () => {
    const insights: Insights = {
      position_id: 'p',
      analysis_id: 'a',
      engine_status: 'ok',
      position: {
        side_to_move: 'white',
        in_check: false,
        checkers: [],
        legal_move_count: 30,
        mate_in_one: ['R@e8#'],
        opponent_mate_threats: ['R@e1#'],
        defenses_to_mate_threats: ['h3', 'Kf1', 'Ra8+'],
        white: { ...side('white'), hanging_pieces: [{ square: 'd4', piece: 'N', color: 'white' }] },
        black: side('black'),
      },
      last_move: null,
      candidates: [candidate(1, dropMate, null, 1), candidate(2, move({ san: 'Qh5', uci: 'd1h5' }), 2.3, null)],
      threat: null,
    }
    const e = explain(insights, 18)!
    expect(e.bestSan).toBe('R@e8#')
    expect(e.score).toBe('#1')
    expect(e.items.map((i) => i.label)).toEqual(['直接作用', '王的安全', '對手應對', '主要變化', 'Pocket'])
    expect(e.tags).toEqual(['Drop mate', '壓縮逃生格'])
    expect(e.comparisons).toHaveLength(1)
    expect(positionAlerts(insights)).toEqual([
      '若不處理，黑方有一步殺：R@e1#。',
      '能擋住一步殺的應著：h3、Kf1。',
      '白方無保護且被攻擊：馬d4。',
    ])
  })
})

describe('line facts and threats', () => {
  it('describes discovered attacks, blocked lines, opened files and mate threats', () => {
    const f = move({
      san: 'exd5',
      uci: 'e4d5',
      discovered_attacks: [{ attacker: 'Rd1', target: 'Qd8' }],
      blocked_lines: [{ attacker: 'Bb4', target: 'Qd2' }],
      opened_file: { file: 'e', kind: 'open' },
      threatens_mate: ['Re8#'],
    })
    expect(directEffects(f)).toEqual([
      '打開線路，閃擊：車d1→后d8。',
      '擋住對方的攻擊線：象b4→后d2。',
      '打開 e 線（全開放）。',
      '威脅下一步 Re8# 將死。',
    ])
  })

  it('warns about a dropped piece that can be taken at a profit and an emptied pocket', () => {
    const f = move({ san: 'N@d6+', uci: 'N@d6', is_check: true, en_prise_to: ['Pc7'], tags: ['drop', 'drop_check', 'pocket_emptied'] })
    expect(directEffects(f)).toEqual([
      '從 pocket 打入馬到 d6，是 drop check（將軍）。',
      '馬可被 兵c7 有利地吃掉（吃到的子進入對方 pocket）。',
      '用掉了 pocket 裡最後一個棋子。',
    ])
  })

  it('does not repeat the blocked check of an interposition drop', () => {
    const f = move({ san: 'N@d2', uci: 'N@d2', tags: ['drop', 'interposition_drop'], blocked_lines: [{ attacker: 'Bb4', target: 'Ke1' }] })
    expect(directEffects(f)).toEqual(['從 pocket 打入馬到 d2。', '這個 drop 擋住了對方的將軍。'])
  })

  it('phrases engine threats from the threatening side', () => {
    expect(threatText({ side: 'black', best_move: 'R@e1#', evaluation: null, mate: -1, evaluation_pov: 'white', depth: 9, pv: [] })).toBe(
      '若不處理，黑方有 R@e1#，可在 1 步內將死（#-1）。',
    )
    expect(threatText({ side: 'white', best_move: 'Qh5', evaluation: 1.5, mate: null, evaluation_pov: 'white', depth: 9, pv: [] })).toBe(
      '若停一手，白方最強是 Qh5（+1.50，白方視角）。',
    )
  })
})

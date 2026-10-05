// Deterministic, fact-only explanation text built from backend Insights.
// Every sentence here restates an engine output or a rules fact; no interpretation.

import { formatScore, scoreOwner } from './evaluation'
import type { CandidateFacts, Color, Insights, LineEffect, MoveFacts, PieceOnSquare, PvPly, ThreatFacts } from './types'

export const PIECE_NAMES: Record<string, string> = { P: '兵', N: '馬', B: '象', R: '車', Q: '后', K: '王' }
const SIDE: Record<Color, string> = { white: '白方', black: '黑方' }

export const TAG_LABELS: Record<string, string> = {
  drop: 'Drop',
  drop_check: 'Drop check',
  drop_mate: 'Drop mate',
  queen_drop: 'Queen drop',
  interposition_drop: '擋將 drop',
  mate: '將死',
  check: '將軍',
  discovered_check: '閃擊將軍',
  knight_fork: '馬雙擊',
  double_attack: '雙重攻擊',
  escape_square_reduction: '壓縮逃生格',
  capture: '吃子',
  promotion: '升變',
  discovered_attack: '閃擊',
  blocks_line: '擋線',
  opens_file: '開線',
  mate_threat: '殺棋威脅',
}

const opposite = (color: Color): Color => (color === 'white' ? 'black' : 'white')
const piece = (p: PieceOnSquare) => `${PIECE_NAMES[p.piece]}${p.square}`
/** "Rd1" -> "車d1"; a bare square stays as is. */
const named = (label: string) => (PIECE_NAMES[label[0]] ? `${PIECE_NAMES[label[0]]}${label.slice(1)}` : label)
const lines = (effects: LineEffect[]) => effects.map((e) => `${named(e.attacker)}→${named(e.target)}`).join('、')
const squares = (list: string[]) => (list.length ? list.join(', ') : '無')

/** Score from the mover's point of view, comparable across lines (mate dominates). */
export function moverValue(line: Pick<CandidateFacts, 'evaluation' | 'mate'>, mover: Color): number {
  const sign = mover === 'white' ? 1 : -1
  if (line.mate !== null) {
    const mate = line.mate * sign
    return mate > 0 ? 10_000 - mate : -10_000 - mate
  }
  return (line.evaluation ?? 0) * sign
}

export function pvText(pv: PvPly[], moveNumber: number, limit = 10): string {
  let number = moveNumber
  return pv
    .slice(0, limit)
    .map((ply, index) => {
      const prefix = ply.color === 'white' ? `${number}.` : index === 0 ? `${number}…` : ''
      if (ply.color === 'black') number += 1
      return `${prefix}${ply.san}`
    })
    .join(' ')
}

export function directEffects(facts: MoveFacts): string[] {
  const out: string[] = []
  const to = facts.move.to
  const name = facts.move.drop ? PIECE_NAMES[facts.move.drop] : ''
  if (facts.is_drop && facts.is_mate) out.push(`從 pocket 打入${name}到 ${to}，直接將死。`)
  else if (facts.is_drop && facts.is_check) out.push(`從 pocket 打入${name}到 ${to}，是 drop check（將軍）。`)
  else if (facts.is_drop) out.push(`從 pocket 打入${name}到 ${to}。`)
  else if (facts.is_mate) out.push('直接將死。')
  else if (facts.is_check) out.push(facts.discovered_check ? '閃擊將軍：移動後由後方棋子將軍。' : '將軍。')
  if (facts.tags.includes('interposition_drop')) out.push('這個 drop 擋住了對方的將軍。')
  if (facts.captured) {
    out.push(
      facts.captured.endsWith('~')
        ? `吃掉升變的${PIECE_NAMES[facts.captured[0]]}；依 Crazyhouse 規則 pocket 只得到兵。`
        : `吃掉${PIECE_NAMES[facts.captured]}，它進入${SIDE[facts.mover]}的 pocket。`,
    )
  }
  if (facts.is_promotion && facts.move.promotion) out.push(`升變為${PIECE_NAMES[facts.move.promotion]}。`)
  const targets = facts.attacks.filter((p) => p.piece !== 'K')
  if (facts.attacks.length >= 2) out.push(`同時攻擊 ${facts.attacks.map(piece).join('、')}。`)
  else if (targets.length === 1 && !facts.is_capture) out.push(`攻擊 ${piece(targets[0])}。`)
  const discovered = facts.discovered_attacks.filter((e) => e.target[0] !== 'K')
  if (discovered.length > 0) out.push(`打開線路，閃擊：${lines(discovered)}。`)
  const blocked = facts.tags.includes('interposition_drop')
    ? facts.blocked_lines.filter((e) => e.target[0] !== 'K')
    : facts.blocked_lines
  if (blocked.length > 0) out.push(`擋住對方的攻擊線：${lines(blocked)}。`)
  if (facts.opened_file) {
    out.push(`打開 ${facts.opened_file.file} 線（${facts.opened_file.kind === 'open' ? '全開放' : '己方半開放'}）。`)
  }
  if (facts.threatens_mate.length > 0) out.push(`威脅下一步 ${facts.threatens_mate.slice(0, 3).join('、')} 將死。`)
  if (out.length === 0) out.push('安靜著：不將軍、不吃子、不 drop。')
  return out
}

/** The engine's answer to "what if the side to move passed?". */
export function threatText(threat: ThreatFacts): string {
  const sign = threat.side === 'white' ? 1 : -1
  const mates = threat.mate !== null && threat.mate * sign > 0
  const score = formatScore(threat)
  return mates
    ? `若不處理，${SIDE[threat.side]}有 ${threat.best_move}，可在 ${Math.abs(threat.mate!)} 步內將死（${score}）。`
    : `若停一手，${SIDE[threat.side]}最強是 ${threat.best_move}（${score}，白方視角）。`
}

export function kingSafety(facts: MoveFacts): string {
  const before = facts.opponent_king_escape_before
  const after = facts.opponent_king_escape_after
  const king = `${SIDE[opposite(facts.mover)]}王`
  if (before.length === after.length && before.every((sq, i) => sq === after[i])) {
    return `${king}可走格不變：${squares(after)}。`
  }
  return `${king}可走格 ${before.length} → ${after.length}（${squares(before)} → ${squares(after)}）。`
}

export function replies(facts: MoveFacts): string {
  if (facts.is_mate) return '對手沒有合法回應。'
  if (facts.forced_replies.length > 0) {
    return `對手只有 ${facts.opponent_reply_count} 個合法回應：${facts.forced_replies.join('、')}。`
  }
  return `對手有 ${facts.opponent_reply_count} 個合法回應。`
}

export function comparison(best: CandidateFacts, other: CandidateFacts, mover: Color): string {
  const parts: string[] = []
  const b = best.facts
  const o = other.facts
  if (best.mate !== null && moverValue(best, mover) > 5_000 && (other.mate === null || moverValue(other, mover) < 5_000)) {
    parts.push(`最佳著可強制將死（${formatScore(best)}），${o.move.san} 不行`)
  } else if (best.mate === null && other.mate === null) {
    const diff = moverValue(best, mover) - moverValue(other, mover)
    parts.push(`比最佳著少 ${diff.toFixed(2)}（${SIDE[mover]}視角）`)
  }
  if (b.is_check && !o.is_check) parts.push(`${b.move.san} 將軍，${o.move.san} 不將軍`)
  if (!b.is_check && o.is_check) parts.push(`${o.move.san} 將軍，但最佳著不是將軍`)
  if (b.forced_replies.length > 0 && o.forced_replies.length === 0) {
    parts.push(`最佳著後對手只有 ${b.opponent_reply_count} 個回應，${o.move.san} 後有 ${o.opponent_reply_count} 個`)
  }
  return parts.join('；') + '。'
}

export interface ExplanationItem {
  label: string
  text: string
}

export interface Explanation {
  bestSan: string
  score: string
  owner: string
  items: ExplanationItem[]
  comparisons: { san: string; score: string; text: string }[]
  alerts: string[]
  tags: string[]
}

export function positionAlerts(insights: Insights): string[] {
  const p = insights.position
  const mover = p.side_to_move
  const own = p[mover]
  const alerts: string[] = []
  if (p.in_check) alerts.push(`${SIDE[mover]}正被將軍（${p.checkers.map(piece).join('、')}）。`)
  if (p.opponent_mate_threats.length > 0) {
    alerts.push(`若不處理，${SIDE[opposite(mover)]}有一步殺：${p.opponent_mate_threats.slice(0, 4).join('、')}。`)
  } else if (insights.threat && insights.threat.mate !== null && insights.threat.mate * (insights.threat.side === 'white' ? 1 : -1) > 0) {
    alerts.push(threatText(insights.threat))
  }
  if (own.hanging_pieces.length > 0) alerts.push(`${SIDE[mover]}無保護且被攻擊：${own.hanging_pieces.map(piece).join('、')}。`)
  const valuables = own.attacked_queens_rooks.filter((v) => !own.hanging_pieces.some((h) => h.square === v.square))
  if (valuables.length > 0) alerts.push(`${SIDE[mover]}的 ${valuables.map(piece).join('、')} 正被攻擊。`)
  return alerts
}

export function explain(insights: Insights, moveNumber: number): Explanation | null {
  const [best, ...others] = insights.candidates
  if (!best) return null
  const mover = insights.position.side_to_move
  const facts = best.facts
  const items: ExplanationItem[] = [
    { label: '直接作用', text: directEffects(facts).join(' ') },
    { label: '王的安全', text: kingSafety(facts) },
    { label: '對手應對', text: replies(facts) },
    {
      label: '主要變化',
      text:
        pvText(best.pv, moveNumber) +
        (best.forcing_checks >= 2 ? `（${SIDE[mover]}開頭連續 ${best.forcing_checks} 次將軍）` : ''),
    },
  ]
  if (insights.threat) items.push({ label: '對手威脅', text: threatText(insights.threat) })
  if (facts.is_drop || facts.is_capture) {
    items.push({ label: 'Pocket', text: `${SIDE[mover]}：[${facts.pocket_before.join('')}] → [${facts.pocket_after.join('')}]` })
  }
  return {
    bestSan: facts.move.san,
    score: formatScore(best),
    owner: scoreOwner(best),
    items,
    comparisons: others.map((other) => ({
      san: other.facts.move.san,
      score: formatScore(other),
      text: comparison(best, other, mover),
    })),
    alerts: positionAlerts(insights),
    tags: facts.tags.filter((tag) => tag in TAG_LABELS && tag !== 'drop').map((tag) => TAG_LABELS[tag]),
  }
}

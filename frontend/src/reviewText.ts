import { formatScore } from './evaluation'
import type { MoveClassification, ReviewPly } from './types'

export const GLYPH: Record<MoveClassification, string> = {
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  mate_missed: '?#',
  mate_allowed: '??#',
}

export const LABEL: Record<MoveClassification, string> = {
  inaccuracy: '不精確',
  mistake: '錯著',
  blunder: '大錯',
  mate_missed: '錯過強制將殺',
  mate_allowed: '讓對手有強制將殺',
}

const score = (evaluation: number | null, mate: number | null) =>
  evaluation !== null || mate !== null ? formatScore({ evaluation, mate }) : '—'

/** Tooltip / list text: verdict, then best vs played, both searched from the same position (White POV). */
export function reviewNote(ply: ReviewPly, before: ReviewPly | undefined): string {
  if (!ply.classification) return ''
  const best = before ? score(before.evaluation, before.mate) : '—'
  const played = score(ply.played_evaluation, ply.played_mate)
  return `${LABEL[ply.classification]}：最佳 ${ply.best_before ?? '—'} ${best}，實戰 ${played}（白方視角）`
}

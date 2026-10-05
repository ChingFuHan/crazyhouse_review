import type { EngineLine } from './types'

/** Lichess-style score text from White's point of view: +1.23, -0.50, #3, #-2. */
export function formatScore(line: Pick<EngineLine, 'evaluation' | 'mate'>): string {
  if (line.mate !== null) return `#${line.mate}`
  const value = line.evaluation ?? 0
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

/** White's share of the eval bar in [0, 1]. Mate scores pin the bar. */
export function whiteShare(line: Pick<EngineLine, 'evaluation' | 'mate'>): number {
  if (line.mate !== null) return line.mate > 0 ? 1 : 0
  // Crazyhouse evaluations swing widely; squash so ±10 pawns is near the ends.
  return 1 / (1 + Math.exp(-(line.evaluation ?? 0) / 4))
}

/** Which side the score favours, in words (Traditional Chinese UI). */
export function scoreOwner(line: Pick<EngineLine, 'evaluation' | 'mate'>): string {
  if (line.mate !== null) return line.mate > 0 ? '白方可強制將死' : '黑方可強制將死'
  const value = line.evaluation ?? 0
  if (Math.abs(value) < 0.5) return '均勢'
  return value > 0 ? '白方優勢' : '黑方優勢'
}

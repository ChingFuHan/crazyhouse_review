// Puzzle themes in words: the analyzer's move tags (the same labels as the "Why" panel) plus the
// puzzle's own; codes without a label are not shown.

import { TAG_LABELS } from '../explain'

const THEMES: Record<string, string> = {
  ...TAG_LABELS,
  quiet_move: '安靜著',
  sacrifice: '棄子',
  tempting_alternative: '誘人的陷阱',
  battle: '對轟',
}

export function themeLabel(theme: string): string | null {
  const mate = theme.match(/^mate_in_(\d+)$/)
  if (mate) return `${mate[1]} 步殺`
  return THEMES[theme] ?? null
}

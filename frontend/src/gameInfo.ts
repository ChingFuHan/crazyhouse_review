// What a PGN's headers say about the game, in words.

/** "180+2" -> "3+2"; "-" -> 不限時; seconds below a minute stay seconds ("30+0" -> "30 秒+0"). */
export function timeControl(raw: string | undefined): string | null {
  if (!raw || raw === '?') return null
  if (raw === '-') return '不限時'
  const match = /^(\d+)\+(\d+)$/.exec(raw)
  if (!match) return raw
  const [base, increment] = [Number(match[1]), match[2]]
  return base % 60 === 0 ? `${base / 60}+${increment}` : `${base} 秒+${increment}`
}

/** The game's page on lichess (from its Site header), or null. */
export function lichessUrl(site: string | undefined): string | null {
  const match = site ? /^https?:\/\/(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})\b/.exec(site) : null
  return match ? `https://lichess.org/${match[1]}` : null
}

/** A header that says something ("?" is PGN for unknown). */
export const known = (value: string | undefined): string | null => (value && value !== '?' && value !== '-' ? value : null)

export function gameDate(headers: Record<string, string>): string | null {
  const date = [headers.UTCDate, headers.Date].find((d) => d && !d.includes('?'))
  return date ? date.replace(/\./g, '-') : null
}

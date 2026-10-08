import { gameDate, known, lichessUrl, timeControl } from '../gameInfo'

const TERMINATION: Record<string, string> = {
  Normal: '正常結束',
  'Time forfeit': '超時',
  Abandoned: '中止',
  'Rules infraction': '違規',
}

/** The PGN's headers in words: players and ratings, result, time control, date, opening, the lichess game. */
export function GameInfo({ headers }: { headers: Record<string, string> }) {
  const player = (name: string | undefined, elo: string | undefined) =>
    known(name) || known(elo) ? `${known(name) ?? '?'}${known(elo) ? `（${elo}）` : ''}` : null
  const rows: [string, string | null][] = [
    ['白方', player(headers.White, headers.WhiteElo)],
    ['黑方', player(headers.Black, headers.BlackElo)],
    [
      '結果',
      headers.Result && headers.Result !== '*'
        ? `${headers.Result}${headers.Termination ? `（${TERMINATION[headers.Termination] ?? headers.Termination}）` : ''}`
        : null,
    ],
    ['時限', timeControl(headers.TimeControl)],
    ['日期', gameDate(headers)],
    ['賽事', known(headers.Event)],
    ['開局', known(headers.Opening) ? `${headers.Opening}${known(headers.ECO) ? `（${headers.ECO}）` : ''}` : null],
  ]
  const shown = rows.filter(([, value]) => value)
  const url = lichessUrl(headers.Site)
  return (
    <section className="panel game-info" data-testid="game-info">
      <h2>對局資訊</h2>
      {shown.length === 0 && !url ? (
        <p className="muted">這盤沒有對局資訊（PGN 標頭）。</p>
      ) : (
        <dl>
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          在 lichess 開原局
        </a>
      )}
    </section>
  )
}

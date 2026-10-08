import { useState } from 'react'
import { USERNAME, fetchGamePgn, fetchUserGames, gameIdOf, type LichessGame } from '../lichess'
import { type RecentGame, recentGames } from '../session'

export interface PgnLoaderProps {
  onLoad: (pgn: string) => Promise<boolean>
  onNewGame: () => void
  onOpenRecent: (game: RecentGame) => Promise<boolean>
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const result = (game: LichessGame) =>
  game.winner === 'white' ? '1-0' : game.winner === 'black' ? '0-1' : ['draw', 'stalemate'].includes(game.status) ? '½-½' : game.status
const day = (ms: number) => new Date(ms).toLocaleDateString('zh-TW')

/** Load a game: paste a PGN or FEN, fetch one from lichess (a game link, or a player's latest
 * crazyhouse games), or reopen a recent one. */
export function PgnLoader({ onLoad, onNewGame, onOpenRecent }: PgnLoaderProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [link, setLink] = useState('')
  const [user, setUser] = useState('')
  const [games, setGames] = useState<LichessGame[] | null>(null)
  const [recent, setRecent] = useState<RecentGame[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (label: string, work: () => Promise<boolean | void>) => {
    setBusy(label)
    setError(null)
    try {
      if ((await work()) === true) setOpen(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  const loadLichess = (id: string) => run('lichess', async () => onLoad(await fetchGamePgn(id)))

  if (!open) {
    return (
      <div className="pgn-loader">
        <button
          onClick={() => {
            setRecent(recentGames())
            setOpen(true)
          }}
        >
          載入對局
        </button>
        <button onClick={onNewGame}>新局面</button>
      </div>
    )
  }
  const id = gameIdOf(link)
  return (
    <div className="pgn-loader open" data-testid="pgn-loader">
      <h3>貼上 PGN／FEN</h3>
      <textarea
        aria-label="PGN"
        placeholder="貼上 Crazyhouse PGN，或一行 Crazyhouse FEN"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        autoFocus
      />
      <div className="row">
        <button disabled={busy !== null || !text.trim()} onClick={() => void run('pgn', () => onLoad(text))}>
          載入
        </button>
        <button onClick={() => setOpen(false)}>取消</button>
      </div>

      <h3>從 lichess</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (id) void loadLichess(id)
        }}
      >
        <input aria-label="lichess 對局網址" placeholder="對局網址或 ID，例如 https://lichess.org/abcd1234" value={link} onChange={(e) => setLink(e.target.value)} />
        <button type="submit" disabled={busy !== null || !id}>
          載入對局
        </button>
      </form>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (USERNAME.test(user.trim())) void run('user', async () => setGames(await fetchUserGames(user.trim())))
        }}
      >
        <input aria-label="lichess 使用者" placeholder="lichess 使用者名稱" value={user} onChange={(e) => setUser(e.target.value)} />
        <button type="submit" disabled={busy !== null || !USERNAME.test(user.trim())}>
          列出最近的 crazyhouse 對局
        </button>
      </form>
      {busy === 'lichess' && <div className="engine-note">從 lichess 取得對局…</div>}
      {busy === 'user' && <div className="engine-note">從 lichess 讀取對局列表…</div>}
      {games && games.length === 0 && <div className="muted">這位使用者沒有 crazyhouse 對局。</div>}
      {games && games.length > 0 && (
        <ul className="loader-list" data-testid="lichess-games">
          {games.map((game) => (
            <li key={game.id}>
              <button className="link" disabled={busy !== null} onClick={() => void loadLichess(game.id)}>
                {day(game.createdAt)} {game.white.name}
                {game.white.rating ? `（${game.white.rating}）` : ''} – {game.black.name}
                {game.black.rating ? `（${game.black.rating}）` : ''} {result(game)}
              </button>
              <span className="muted">
                {[game.clock, game.opening].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <>
          <h3>最近的對局</h3>
          <ul className="loader-list" data-testid="recent-games">
            {recent.map((game) => (
              <li key={game.key}>
                <button className="link" disabled={busy !== null} onClick={() => void run('recent', () => onOpenRecent(game))}>
                  {game.label}
                </button>
                <span className="muted"> {new Date(game.savedAt).toLocaleString('zh-TW')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="engine-error">{error}</div>}
    </div>
  )
}

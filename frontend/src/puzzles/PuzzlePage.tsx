import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { copyText } from '../clipboard'
import { Nav } from '../components/Nav'
import { ReviewBoard } from '../components/ReviewBoard'
import { goTo } from '../route'
import { openInReview } from '../session'
import { PUZZLE_TYPE_NAMES, type PuzzleType } from '../types'
import { PuzzleLibrary } from './PuzzleLibrary'
import { usePlayer } from './usePlayer'
import { type PuzzleState, usePuzzle } from './usePuzzle'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const TYPES_KEY = 'crazyhouse-review:puzzle-types'
const SIDE = { white: '白方', black: '黑方' }
const VERDICTS = { best: '最佳', good: '好著', inaccuracy: '不精確', mistake: '錯著', blunder: '大錯' }
const RESULTS: Record<string, string> = { '1': '勝：局勢比開局更好', '0.5': '和：守住了局勢', '0': '負：局勢變差' }
const THEMES: Record<string, string> = {
  quiet_move: '安靜著',
  sacrifice: '棄子',
  tempting_alternative: '誘人的陷阱',
  drop: '打入',
  drop_check: '打入將軍',
  drop_mate: '打入將殺',
  queen_drop: '打入后',
  knight_fork: '馬雙抽',
  double_attack: '雙重攻擊',
  discovered_attack: '閃擊',
  escape_square_reduction: '封鎖逃生格',
  interposition_drop: '打入擋將',
  battle: '對轟',
}

function loadTypes(): PuzzleType[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TYPES_KEY) ?? 'null') as PuzzleType[] | null
    const valid = (saved ?? []).filter((t) => TYPES.includes(t))
    return valid.length ? valid : TYPES
  } catch {
    return TYPES
  }
}

function instruction(state: PuzzleState): string {
  const p = state.puzzle!
  const side = SIDE[p.solver]
  switch (p.type) {
    case 'attack':
      return `${side}走：找出致勝的著法（共 ${p.solver_moves} 步）`
    case 'defense':
      return `${side}走：對手有致命威脅，找出唯一能守住的著法（共 ${p.solver_moves} 步）`
    case 'tactics':
      return `${side}走：中局攻防，連續找出 ${p.solver_moves} 步唯一好著`
    case 'battle':
      return `${side}走：與 engine 對下 ${p.battle_plies} 步，維持或擴大局勢`
  }
}

const percent = (chances: number) => `${Math.round(((chances + 1) / 2) * 100)}%`

export function PuzzlePage() {
  const { player, error: playerError, signIn, signOut, setRating } = usePlayer()
  const [nickname, setNickname] = useState('')
  const [types, setTypes] = useState<PuzzleType[]>(loadTypes)
  const { state, next, play, hint, giveUp, showSolution } = usePuzzle(player?.nickname ?? null, setRating)
  const [copied, setCopied] = useState<string | null>(null)
  const { puzzle, position, status } = state
  const over = status === 'solved' || status === 'failed' || status === 'finished'

  const toggleType = (type: PuzzleType) => {
    const chosen = types.includes(type) ? types.filter((t) => t !== type) : [...types, type]
    const valid = chosen.length ? chosen : [type]
    setTypes(valid)
    try {
      localStorage.setItem(TYPES_KEY, JSON.stringify(valid))
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    if (player && status === 'idle') void next(types)
    // first puzzle once signed in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player])

  const shapes = useMemo<DrawShape[]>(() => {
    if (!state.hint?.square) return []
    return [{ orig: state.hint.square as Key, brush: 'green' }]
  }, [state.hint])

  const exported = async (kind: 'fen' | 'pgn' | 'lichess' | 'review') => {
    if (!puzzle || !player) return
    const data = await api.exportPuzzle(puzzle.id, player.nickname)
    if (kind === 'lichess') {
      window.open(data.lichess_analysis_url, '_blank', 'noopener')
      return
    }
    if (kind === 'review') {
      openInReview(data.pgn)
      goTo('review')
      return
    }
    const ok = await copyText(kind === 'fen' ? data.lichess_fen : data.pgn)
    setCopied(ok ? `已複製 ${kind.toUpperCase()}${kind === 'pgn' && data.solution_shown ? '（含解答）' : ''}` : '無法存取剪貼簿')
  }

  return (
    <div className="app puzzle-page" data-testid="puzzle-page">
      <header className="topbar">
        <h1>Crazyhouse Review</h1>
        <Nav current="puzzles" />
        <div className="player-box" data-testid="player-box">
          {player ? (
            <>
              <span>
                <strong>{player.nickname}</strong> · rating <strong data-testid="player-rating">{Math.round(player.rating)}</strong>
                {player.rd > 150 && <span className="muted">（暫定）</span>}
              </span>
              <button onClick={signOut}>登出</button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (nickname.trim()) void signIn(nickname)
              }}
            >
              <input aria-label="暱稱" placeholder="輸入暱稱開始解題" value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} />
              <button type="submit" disabled={!nickname.trim()}>
                登入
              </button>
            </form>
          )}
        </div>
      </header>
      {playerError && <div className="error">{playerError}</div>}

      <main className="layout">
        <section className="board-column">
          {position && puzzle ? (
            <ReviewBoard position={position} orientation={puzzle.solver} onPlay={play} shapes={shapes} />
          ) : (
            <div className="panel engine-note puzzle-empty">
              {!player ? '輸入暱稱登入後開始解題；rating 會依你的表現調整題目難度。' : status === 'loading' ? '載入題目中…' : state.message}
            </div>
          )}
        </section>

        <aside className="side-column">
          <section className="panel puzzle-info" data-testid="puzzle-info">
            <div className="puzzle-types" role="group" aria-label="題型">
              {TYPES.map((type) => (
                <label key={type} className="toggle chip">
                  <input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} />
                  {PUZZLE_TYPE_NAMES[type]}
                </label>
              ))}
            </div>
            {puzzle && (
              <>
                <h2>
                  {puzzle.type_name} <span className="muted">#{puzzle.id} · 題目 rating {puzzle.rating}{puzzle.rated ? '' : ' · 已做過（不計分）'}</span>
                </h2>
                <p className="puzzle-task" data-testid="puzzle-task">
                  {instruction(state)}
                </p>
                {puzzle.themes.length > 0 && over && (
                  <div className="tags">
                    {puzzle.themes.map((t) => (
                      <span key={t} className="tag">
                        {THEMES[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
            {status === 'thinking' && <div className="engine-note">判定中…</div>}
            {state.message && puzzle && (
              <div className={`puzzle-feedback ${status}`} data-testid="puzzle-feedback">
                {state.message}
              </div>
            )}
            {state.hint && (
              <div className="engine-note" data-testid="puzzle-hint">
                提示：{state.hint.drop ? `從 pocket 打入${state.hint.drop}` : `移動 ${state.hint.square} 的棋子`}
              </div>
            )}

            {puzzle?.type === 'battle' && state.battle.length > 0 && (
              <ol className="battle-log" data-testid="battle-log">
                {state.battle.map((b, i) => (
                  <li key={i} className={b.verdict}>
                    {b.played.san} <strong>{VERDICTS[b.verdict]}</strong>
                    {b.verdict !== 'best' && b.best && <span className="muted">（engine：{b.best.san}）</span>}
                    {b.reply && <span> · engine 回 {b.reply.san}</span>}
                    <span className="muted"> · 勝率 {percent(b.chances_played)}</span>
                  </li>
                ))}
              </ol>
            )}
            {status === 'finished' && state.battle.at(-1)?.result != null && (
              <div className="puzzle-feedback finished" data-testid="battle-result">
                {RESULTS[String(state.battle.at(-1)!.result)]}（開局勝率 → 結束 {percent(state.battle.at(-1)!.final_chances ?? 0)}）
              </div>
            )}

            {state.rating && (
              <div className="rating-change" data-testid="rating-change">
                {state.rating.rated ? (
                  <>
                    rating {state.rating.before} → <strong>{state.rating.after}</strong>（
                    {state.rating.after >= state.rating.before ? '+' : ''}
                    {state.rating.after - state.rating.before}）· 題目 {state.rating.puzzle_before} → {state.rating.puzzle_after}
                  </>
                ) : (
                  '已做過這一題：不計分'
                )}
              </div>
            )}

            {over && state.solution.length > 0 && (
              <div className="puzzle-solution" data-testid="puzzle-solution">
                解答：
                {state.solution.map((m, i) => (
                  <button key={i} className="link" onClick={() => void showSolution(i + 1)}>
                    {m.san}
                  </button>
                ))}
              </div>
            )}

            <div className="puzzle-actions">
              {puzzle && puzzle.type !== 'battle' && status === 'solving' && (
                <>
                  <button onClick={() => void hint()} disabled={state.hintUsed}>
                    提示
                  </button>
                  <button onClick={() => void giveUp()}>看解答</button>
                </>
              )}
              {player && (
                <button className="primary" onClick={() => void next(types)} disabled={status === 'loading' || status === 'thinking'}>
                  {puzzle && !over ? '跳過，下一題' : '下一題'}
                </button>
              )}
            </div>

            {puzzle && (
              <div className="puzzle-export" data-testid="puzzle-export">
                <button onClick={() => void exported('fen')}>複製 FEN</button>
                <button onClick={() => void exported('pgn')}>複製 PGN</button>
                <button onClick={() => void exported('lichess')}>在 lichess 分析／對戰</button>
                <button onClick={() => void exported('review')}>在復盤棋盤分析</button>
                {copied && <span className="muted">{copied}</span>}
              </div>
            )}
          </section>

          <PuzzleLibrary />
        </aside>
      </main>
    </div>
  )
}

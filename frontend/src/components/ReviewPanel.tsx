import { useEffect, useMemo, useState } from 'react'
import { LABEL, reviewNote } from '../reviewText'
import { known } from '../gameInfo'
import { summarize } from '../reviewSummary'
import { isTyping } from '../typing'
import { type GameTree, mainlineAncestor } from '../tree'
import type { Color, MoveClassification } from '../types'
import type { GameReview } from '../useGameReview'
import { EvalGraph } from './EvalGraph'

export interface ReviewPanelProps {
  tree: GameTree
  review: GameReview
  activeId: string
  onSelect: (id: string) => void
  auto: boolean
  onToggleAuto: () => void
  /** On a learning exercise: the critical moments (with the engine's best moves) stay hidden. */
  practising?: boolean
}

type Side = 'both' | Color
const COLUMNS: [string, MoveClassification[]][] = [
  ['不精確', ['inaccuracy']],
  ['錯著', ['mistake']],
  ['大錯', ['blunder']],
  ['殺棋相關', ['mate_missed', 'mate_allowed']],
]

/** Whole-game review: eval graph, a summary per side, and the critical moments (filtered, with
 * previous / next mistake from the current move, also on the p / n keys). */
export function ReviewPanel({ tree, review, activeId, onSelect, auto, onToggleAuto, practising = false }: ReviewPanelProps) {
  const { job, error } = review
  const running = job?.status === 'running'
  const rootSide = tree.nodes[tree.rootId].state.side_to_move
  const [side, setSide] = useState<Side>('both')
  const [withInaccuracies, setWithInaccuracies] = useState(true)

  const critical = useMemo(
    () =>
      (job?.plies ?? []).filter((p) => {
        if (!p.classification || !tree.nodes[p.position_id]) return false
        if (!withInaccuracies && p.classification === 'inaccuracy') return false
        const mover = tree.nodes[p.position_id].state.side_to_move === 'white' ? 'black' : 'white'
        return side === 'both' || mover === side
      }),
    [job, tree, side, withInaccuracies],
  )
  const summary = useMemo(() => (job?.status === 'done' ? summarize(job.plies, rootSide) : null), [job, rootSide])

  // Where we are on the main line (a variation counts from where it left the game).
  const currentPly = tree.nodes[mainlineAncestor(tree, activeId)].state.ply
  const previous = [...critical].reverse().find((p) => p.ply < currentPly)
  const next = critical.find((p) => p.ply > currentPly)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.key === 'n' ? next : event.key === 'p' ? previous : undefined
      if (target) {
        event.preventDefault()
        onSelect(target.position_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, previous, onSelect])

  const name = (color: Color) => known(color === 'white' ? tree.headers.White : tree.headers.Black)

  return (
    <section className="panel review" data-testid="review">
      <header className="engine-header">
        <h2>整局分析</h2>
        <label className="toggle" title="載入對局（或主線改變）後自動在背景分析整盤">
          <input type="checkbox" checked={auto} onChange={onToggleAuto} />
          自動
        </label>
        <button onClick={review.start} disabled={running}>
          {job ? '重新分析' : '分析主線'}
        </button>
      </header>
      {error && <div className="engine-error">整局分析失敗：{error}</div>}
      {job && running && (
        <div className="engine-note" data-testid="review-progress">
          分析中 {job.done}/{job.total}
        </div>
      )}
      {job && job.plies.length > 1 && <EvalGraph tree={tree} job={job} activeId={activeId} onSelect={onSelect} />}

      {summary && (
        <table className="review-summary" data-testid="review-summary">
          <thead>
            <tr>
              <th />
              <th>準確度</th>
              {COLUMNS.map(([label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['white', 'black'] as Color[]).map((color) => (
              <tr key={color} data-side={color}>
                <th>
                  {color === 'white' ? '白方' : '黑方'}
                  {name(color) ? <span className="muted"> {name(color)}</span> : null}
                </th>
                <td>{summary[color].accuracy === null ? '—' : `${Math.round(summary[color].accuracy!)}%`}</td>
                {COLUMNS.map(([label, kinds]) => (
                  <td key={label}>{kinds.reduce((n, kind) => n + (summary[color].counts[kind] ?? 0), 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!practising && job && (job.plies.some((p) => p.classification) || job.status === 'done') && (
        <div className="review-filters" role="group" aria-label="失誤篩選">
          <select aria-label="哪一方的失誤" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="both">雙方</option>
            <option value="white">白方</option>
            <option value="black">黑方</option>
          </select>
          <label className="toggle">
            <input type="checkbox" checked={withInaccuracies} onChange={(e) => setWithInaccuracies(e.target.checked)} />
            含不精確
          </label>
          <button disabled={!previous} onClick={() => previous && onSelect(previous.position_id)} title="上一個失誤 (p)">
            ◀ 上一個失誤
          </button>
          <button disabled={!next} onClick={() => next && onSelect(next.position_id)} title="下一個失誤 (n)">
            下一個失誤 ▶
          </button>
        </div>
      )}
      {!practising && job?.status === 'done' && critical.length === 0 && <div className="engine-note">沒有符合的失誤。</div>}
      {!practising && critical.length > 0 && (
        <ul className="critical" data-testid="critical">
          {critical.map((ply) => {
            const node = tree.nodes[ply.position_id]
            const before = job!.plies[ply.ply - 1]
            return (
              <li key={ply.position_id} className={`${ply.classification!}${ply.position_id === activeId ? ' current' : ''}`}>
                <button className="link" onClick={() => onSelect(ply.position_id)}>
                  {node.state.move_number - (node.state.side_to_move === 'white' ? 1 : 0)}
                  {node.state.side_to_move === 'white' ? '…' : '.'}
                  {node.state.last_move?.san}
                </button>{' '}
                <span className="critical-label">{LABEL[ply.classification!]}</span>{' '}
                <span className="critical-note">{reviewNote(ply, before).split('：')[1]}</span>
              </li>
            )
          })}
        </ul>
      )}
      {job && <p className="why-source">Fairy-Stockfish 每步短時間分析；標記依勝率變化與將殺狀態判定；準確度依 lichess 的每步公式取平均。</p>}
    </section>
  )
}

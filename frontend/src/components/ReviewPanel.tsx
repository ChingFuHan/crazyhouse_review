import { LABEL, reviewNote } from '../reviewText'
import type { GameTree } from '../tree'
import type { GameReview } from '../useGameReview'

/** Whole-game review controls and the list of critical moments on the main line. */
export function ReviewPanel({ tree, review, onSelect }: { tree: GameTree; review: GameReview; onSelect: (id: string) => void }) {
  const { job, error, byPosition } = review
  const running = job?.status === 'running'
  const critical = (job?.plies ?? []).filter((p) => p.classification && tree.nodes[p.position_id])

  return (
    <section className="panel review" data-testid="review">
      <header className="engine-header">
        <h2>整局分析</h2>
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
      {job?.status === 'done' && critical.length === 0 && <div className="engine-note">主線沒有發現明顯失誤。</div>}
      {critical.length > 0 && (
        <ul className="critical" data-testid="critical">
          {critical.map((ply) => {
            const node = tree.nodes[ply.position_id]
            const before = job!.plies[ply.ply - 1]
            return (
              <li key={ply.position_id} className={ply.classification!}>
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
      {byPosition.size > 0 && <p className="why-source">Fairy-Stockfish 每步短時間分析；標記依勝率變化與將殺狀態判定。</p>}
    </section>
  )
}

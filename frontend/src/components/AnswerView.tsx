import type { Turn } from '../useConversation'
import { RichText } from './RichText'

/** One LLM answer with its provenance (which position / engine result it was grounded on). */
export function AnswerView({ turn }: { turn: Turn }) {
  if (turn.pending) {
    if (!turn.partial) return <div className="engine-note">AI 思考中…</div>
    return (
      <div className="answer streaming" aria-busy="true">
        <RichText text={turn.partial} />
        <div className="answer-meta">
          <span className="spinner" aria-label="streaming" /> 回答中…
        </div>
      </div>
    )
  }
  if (turn.error) return <div className="engine-error">{turn.error}</div>
  const answer = turn.answer!
  if (answer.refused) return <div className="engine-note">AI 拒絕回答這個問題。</div>
  return (
    <div className="answer" data-position-id={answer.position_id} data-analysis-id={answer.analysis_id}>
      <RichText text={answer.text} />
      {answer.unverified_moves.length > 0 && (
        <div className="unverified" role="note" data-testid="unverified">
          注意：回答提到的 {answer.unverified_moves.join('、')} 不是目前的合法著，也不在 Engine 分析或棋譜中，可能不正確。
        </div>
      )}
      <div className="answer-meta">
        {answer.model === 'fake' ? (
          <span className="badge fake">測試用假 LLM</span>
        ) : answer.model === 'rules' ? (
          <span>規則判定（未使用 LLM）</span>
        ) : (
          <span>{answer.model}</span>
        )}
        {answer.cached && <span>（快取）</span>}
      </div>
    </div>
  )
}

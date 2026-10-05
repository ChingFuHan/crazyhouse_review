import type { Turn } from '../useConversation'
import { RichText } from './RichText'

/** One LLM answer with its provenance (which position / engine result it was grounded on). */
export function AnswerView({ turn }: { turn: Turn }) {
  if (turn.pending) return <div className="engine-note">AI 思考中…</div>
  if (turn.error) return <div className="engine-error">{turn.error}</div>
  const answer = turn.answer!
  if (answer.refused) return <div className="engine-note">AI 拒絕回答這個問題。</div>
  return (
    <div className="answer" data-position-id={answer.position_id} data-analysis-id={answer.analysis_id}>
      <RichText text={answer.text} />
      <div className="answer-meta">
        {answer.model === 'fake' ? <span className="badge fake">測試用假 LLM</span> : <span>{answer.model}</span>}
        {answer.cached && <span>（快取）</span>}
      </div>
    </div>
  )
}

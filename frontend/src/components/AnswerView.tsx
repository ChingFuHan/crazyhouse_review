import { useEffect, useState } from 'react'
import type { PromptRecord } from '../types'
import type { Turn } from '../useConversation'
import { RichText } from './RichText'

/** Seconds since mount, ticking: a real model can think for a minute before the first word. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  return seconds > 0 ? <span>（{seconds} 秒）</span> : null
}

/** Everything the model received for this answer, so the viewer can check what it was told. */
function PromptView({ prompt }: { prompt: PromptRecord }) {
  return (
    <details className="ai-input" data-testid="ai-input">
      <summary>AI 看到的資料</summary>
      <h4>System prompt（固定規則）</h4>
      <pre>{prompt.system}</pre>
      {prompt.messages.map((message, index) => (
        <div key={index}>
          <h4>
            {message.role === 'assistant'
              ? '先前的 AI 回答'
              : index === prompt.messages.length - 1
                ? '這次的提問（含 <position_context> 局面資料）'
                : '先前的提問'}
          </h4>
          <pre>{message.content}</pre>
        </div>
      ))}
    </details>
  )
}

/** One LLM answer with its provenance (which position / engine result it was grounded on). */
export function AnswerView({ turn }: { turn: Turn }) {
  if (turn.pending) {
    if (!turn.partial) {
      return (
        <div className="engine-note" data-testid="ai-waiting">
          AI 思考中…<Elapsed />
        </div>
      )
    }
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
      {answer.warnings.length > 0 && (
        <div className="unverified" role="note" data-testid="answer-warnings">
          自動檢查發現以下說法沒有 Engine 或規則依據，可能不正確：
          <ul>
            {answer.warnings.map((warning) => (
              <li key={`${warning.kind}:${warning.quote}`} data-kind={warning.kind}>
                {warning.detail}
              </li>
            ))}
          </ul>
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
      {answer.prompt && <PromptView prompt={answer.prompt} />}
    </div>
  )
}

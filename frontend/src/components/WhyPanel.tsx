import { TAG_LABELS, directEffects, explain } from '../explain'
import type { PositionState } from '../types'
import type { Turn } from '../useConversation'
import type { InsightsView } from '../useInsights'
import { AnswerView } from './AnswerView'

export interface WhyPanelProps {
  position: PositionState
  view: InsightsView
  /** Latest "explain the best move" turn for this position, if any. */
  aiTurn: Turn | undefined
  onExplain: () => void
}

export function WhyPanel({ position, view, aiTurn, onExplain }: WhyPanelProps) {
  const { insights, loading, error, engineMismatch } = view
  const explanation = insights ? explain(insights, position.move_number) : null
  const last = insights?.last_move

  return (
    <section className="panel why" data-testid="why" data-position-id={insights?.position_id ?? ''} data-analysis-id={insights?.analysis_id ?? ''}>
      <h2>Why this move?</h2>
      {error && <div className="engine-error">無法取得局面事實：{error}</div>}
      {engineMismatch && <div className="notice">Engine 結果已更新，以下事實可能對應較舊的分析。</div>}
      {!insights && !error && <div className="engine-note">{loading ? '整理局面事實中…' : '等待 Engine 分析完成…'}</div>}

      {insights && insights.position && explanation && (
        <>
          {explanation.alerts.length > 0 && (
            <ul className="alerts" data-testid="alerts">
              {explanation.alerts.map((alert) => (
                <li key={alert}>{alert}</li>
              ))}
            </ul>
          )}
          <div className="why-head">
            最佳著 <strong data-testid="why-best">{explanation.bestSan}</strong>
            <span className="why-score">{explanation.score}</span>
            <span className="eval-owner">{explanation.owner}</span>
          </div>
          <dl className="why-items">
            {explanation.items.map((item) => (
              <div key={item.label} className="why-item">
                <dt>{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
          {explanation.comparisons.length > 0 && (
            <div className="why-compare">
              <h3>其他候選著</h3>
              <ul>
                {explanation.comparisons.map((c) => (
                  <li key={c.san}>
                    <strong>{c.san}</strong> <span className="why-score">{c.score}</span> {c.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {explanation.tags.length > 0 && (
            <div className="tags" data-testid="tags">
              {explanation.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {insights && !explanation && last && (
        <div className="why-last" data-testid="why-last">
          上一步 <strong>{last.move.san}</strong>：{directEffects(last).join(' ')}
          <div className="tags">
            {last.tags.filter((t) => t in TAG_LABELS && t !== 'drop').map((t) => (
              <span key={t} className="tag">
                {TAG_LABELS[t]}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="why-source">以上皆由 Fairy-Stockfish 輸出與規則計算得出（評估為白方視角）。</p>

      <div className="ai-explain" data-testid="ai-explain">
        <button onClick={onExplain} disabled={aiTurn?.pending}>
          {aiTurn?.answer ? '重新詢問 AI 解釋' : 'AI 解釋'}
        </button>
        {aiTurn && <AnswerView turn={aiTurn} />}
      </div>
    </section>
  )
}

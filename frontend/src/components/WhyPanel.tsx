import { TAG_LABELS, directEffects, explain } from '../explain'
import type { PositionState } from '../types'
import type { Turn } from '../useConversation'
import type { InsightsView } from '../useInsights'
import { AnswerView } from './AnswerView'

export interface WhyPanelProps {
  position: PositionState
  view: InsightsView
  engineOn: boolean
  /** Latest "explain the best move" turn for this position, if any. */
  aiTurn: Turn | undefined
  onExplain: () => void
  autoExplain: boolean
  onToggleAutoExplain: () => void
  /** Which AI answers (chosen in the Ask panel). */
  aiLabel: string
  onCancel: (turnId: number) => void
}

export function WhyPanel({ position, view, engineOn, aiTurn, onExplain, autoExplain, onToggleAutoExplain, aiLabel, onCancel }: WhyPanelProps) {
  const { insights, loading, error, engineMismatch } = view
  const explanation = insights ? explain(insights, position.move_number) : null
  const last = insights?.last_move

  return (
    <section className="panel why" data-testid="why" data-position-id={insights?.position_id ?? ''} data-analysis-id={insights?.analysis_id ?? ''}>
      <h2>Why this move?</h2>
      {error && <div className="engine-error">無法取得局面事實：{error}</div>}
      {engineMismatch && <div className="notice">Engine 結果已更新，以下事實可能對應較舊的分析。</div>}
      {!insights && !error && (
        <div className="engine-note">
          {!engineOn ? 'Engine 已關閉：開啟後顯示最佳著的事實說明。' : loading ? '整理局面事實中…' : '等待 Engine 分析完成…'}
        </div>
      )}

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
                  <li key={c.uci}>
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
      <p className="why-source" data-testid="why-source">
        以上皆由 Fairy-Stockfish 輸出與規則計算得出（評估為白方視角）
        {insights && insights.engine_status !== 'game_over' && (
          <>
            ，根據 depth {insights.depth}
            {insights.engine_status === 'running' && '（分析進行中）'}
          </>
        )}
        {loading && insights && '，更新中…'}。
      </p>

      <div className="ai-explain" data-testid="ai-explain">
        <div className="ai-controls">
          <button onClick={onExplain} disabled={aiTurn?.pending}>
            {aiTurn?.answer ? '重新詢問 AI 解釋' : 'AI 解釋'}
          </button>
          <label className="toggle" title="分析完成並停留 1.5 秒後自動解釋；快速瀏覽不會呼叫 AI">
            <input type="checkbox" checked={autoExplain} onChange={onToggleAutoExplain} aria-label="停留時自動解釋" />
            停留時自動解釋
          </label>
        </div>
        <div className="ai-source" title="在下方「Ask about this position」的 ⚙ 更改">
          AI：{aiLabel}
        </div>
        {aiTurn && <AnswerView turn={aiTurn} onCancel={() => onCancel(aiTurn.id)} />}
      </div>
    </section>
  )
}

import { formatScore, scoreOwner, whiteShare } from '../evaluation'
import type { EngineLine, MoveModel, PositionState } from '../types'
import type { EngineView } from '../useEngine'

export interface EnginePanelProps {
  position: PositionState
  engine: EngineView
  /** Play the first `count` moves of a line from the current position. */
  onPlayLine: (moves: MoveModel[]) => void
  enabled: boolean
  onToggle: () => void
}

function pvTokens(position: PositionState, line: EngineLine, onPlayLine: (moves: MoveModel[]) => void) {
  let moveNumber = position.move_number
  let white = position.side_to_move === 'white'
  return line.pv.slice(0, 12).map((move, index) => {
    const label = white ? `${moveNumber}.` : index === 0 ? `${moveNumber}…` : ''
    if (!white) moveNumber += 1
    white = !white
    return (
      <span
        key={index}
        className="pv-move"
        data-uci={move.uci}
        title="走到這一步"
        onClick={() => onPlayLine(line.pv.slice(0, index + 1))}
      >
        {label && <span className="move-number">{label}</span>}
        {move.san}
      </span>
    )
  })
}

export function EnginePanel({ position, engine, onPlayLine, enabled, onToggle }: EnginePanelProps) {
  const { analysis, status, error } = engine
  const best = analysis?.lines[0]

  return (
    <section
      className="panel engine"
      data-testid="engine"
      data-position-id={analysis?.position_id ?? ''}
      data-analysis-id={status === 'done' ? (analysis?.analysis_id ?? '') : ''}
    >
      <header className="engine-header">
        <h2>Engine</h2>
        <span className="engine-meta">
          {analysis ? `${analysis.engine} · depth ${analysis.depth}` : 'Fairy-Stockfish'}
          {status === 'analyzing' && <span className="spinner" aria-label="analyzing" />}
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={onToggle} aria-label="Engine 開關" />
            {enabled ? '開' : '關'}
          </label>
        </span>
      </header>
      {!enabled && <div className="engine-note">Engine 已關閉。</div>}

      {error && <div className="engine-error">Engine 錯誤：{error}</div>}
      {analysis?.status === 'game_over' && (
        <div className="engine-note">對局已結束（{position.outcome?.termination}），無需分析。</div>
      )}

      {best && (
        <>
          <div className="eval-row">
            <span className="eval-score" data-testid="eval-score">
              {formatScore(best)}
            </span>
            <span className="eval-owner">{scoreOwner(best)}</span>
            <span className="eval-pov" title="所有評估皆為白方視角">白方視角</span>
          </div>
          <div className="eval-bar" aria-hidden>
            <div className="eval-bar-white" style={{ width: `${whiteShare(best) * 100}%` }} />
          </div>
          <div className="best-move">
            最佳著 <strong data-testid="best-move">{best.pv[0].san}</strong>
          </div>
          <ol className="engine-lines">
            {analysis.lines.map((line) => (
              <li key={line.rank} className="engine-line" data-rank={line.rank}>
                <span className={`line-score${line.mate !== null ? ' mate' : ''}`}>{formatScore(line)}</span>
                <span className="pv">{pvTokens(position, line, onPlayLine)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {enabled && !best && !error && analysis?.status !== 'game_over' && <div className="engine-note">分析中…</div>}
    </section>
  )
}

import { useState } from 'react'
import { formatScore } from '../evaluation'
import type { CheckedMove, Color } from '../types'
import type { Turn } from '../useConversation'
import type { AiChoiceView } from '../aiChoice'
import { type ScanState, scanLabel } from '../useGameScan'
import { AiSettings } from './AiSettings'
import { AnswerView } from './AnswerView'

export interface ChatPanelProps {
  turns: Turn[]
  onAsk: (question: string) => void
  bestSan: string | null
  secondSan: string | null
  /** SAN of the move the game actually played from this position, if any. */
  gameMoveSan: string | null
  /** Whole-game scans of each side's errors (not tied to the current position). */
  scans: Partial<Record<Color, ScanState>>
  onScan: (side: Color) => void
  onCancelScan: (side: Color) => void
  /** Stop a pending answer (its AI run ends). */
  onCancel: (turnId: number) => void
  ai: AiChoiceView
}

const SIDES: Color[] = ['white', 'black']

function quickQuestions({ bestSan, secondSan, gameMoveSan }: Pick<ChatPanelProps, 'bestSan' | 'secondSan' | 'gameMoveSan'>): string[] {
  const out: string[] = []
  if (bestSan) out.push(`為什麼是 ${bestSan}？`, `${bestSan} 威脅什麼？`)
  if (secondSan) out.push(`為什麼不是 ${secondSan}？`)
  if (gameMoveSan && gameMoveSan !== bestSan) out.push(`我實戰走 ${gameMoveSan}，錯在哪？`)
  out.push('對手最強反擊是什麼？', '這裡需要防守什麼？', '我應該記住什麼 Pattern？')
  return out
}

function checkedText(move: CheckedMove): string {
  const name = move.san ?? move.input
  if (!move.legal) return `${name}：不合法（${move.reason}）`
  if (move.source === 'unavailable') return `${name}：Engine 無法分析`
  if (move.source === 'not_analyzed') return `${name}：合法，但未做 Engine 分析（每題最多分析 3 步）`
  const score = move.mate !== null || move.evaluation !== null ? formatScore(move) : ''
  const source = move.source === 'multipv' ? `Engine 第 ${move.multipv_rank} 候選` : move.source === 'rules' ? '規則判定' : 'Engine 重新分析'
  return `${name}：${score}（${source}，白方視角）`
}

/** "Ask about this position": quick questions and free questions share one backend pipeline. */
export function ChatPanel(props: ChatPanelProps) {
  const { turns, onAsk, scans, onScan, onCancelScan, onCancel, ai } = props
  const [text, setText] = useState('')
  const chat = turns.filter((t) => t.question !== null)
  // Answers take a while (agy: 30–60 s), so asking never waits for other answers (including the
  // AI explanation); only a question that is already waiting cannot be sent twice.
  const waiting = new Set(chat.filter((t) => t.pending).map((t) => t.question))

  const send = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || waiting.has(trimmed)) return
    onAsk(trimmed)
    setText('')
  }

  return (
    <section className="panel chat" data-testid="chat">
      <h2>Ask about this position</h2>
      <AiSettings ai={ai} />
      <div className="quick-questions">
        {quickQuestions(props).map((q) => (
          <button key={q} className="chip" disabled={waiting.has(q)} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="game-scan" data-testid="game-scan">
        {SIDES.map((side) => (
          <button
            key={side}
            className="chip scan"
            data-side={side}
            disabled={scans[side]?.pending}
            title="依整局分析找出這一方的錯誤與錯過的機會，再由 AI 解釋（需等整局分析完成）"
            onClick={() => onScan(side)}
          >
            {scanLabel(side)}
          </button>
        ))}
      </div>
      {SIDES.map((side) => {
        const result = scans[side]
        if (!result) return null
        const reviewing = result.pending && !result.partial && result.progress && result.progress.done < result.progress.total
        return (
          <div key={side} className="chat-turn scan-result" data-testid={`scan-${side}`}>
            <div className="chat-question">{result.question}</div>
            {reviewing && (
              <div className="engine-note" data-testid="scan-progress">
                整局分析中 {result.progress!.done}/{result.progress!.total}…
              </div>
            )}
            <AnswerView turn={result} onCancel={() => onCancelScan(side)} />
          </div>
        )
      })}
      <ol className="chat-turns">
        {chat.map((turn) => (
          <li key={turn.id} className="chat-turn">
            <div className="chat-question">{turn.question}</div>
            {turn.answer && turn.answer.checked_moves.length > 0 && (
              <ul className="checked-moves" data-testid="checked-moves">
                {turn.answer.checked_moves.map((m, index) => (
                  <li key={index} className={m.legal ? 'legal' : 'illegal'}>
                    {checkedText(m)}
                  </li>
                ))}
              </ul>
            )}
            <AnswerView turn={turn} onCancel={() => onCancel(turn.id)} />
          </li>
        ))}
      </ol>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <input
          aria-label="提問"
          placeholder="例如：為什麼不能 Qxe2？如果我改走 Qh5 呢？"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim() || waiting.has(text.trim())}>
          Send
        </button>
      </form>
    </section>
  )
}

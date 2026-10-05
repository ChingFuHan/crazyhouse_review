import { useState } from 'react'
import { formatScore } from '../evaluation'
import type { CheckedMove } from '../types'
import type { Turn } from '../useConversation'
import { AnswerView } from './AnswerView'

export interface ChatPanelProps {
  turns: Turn[]
  onAsk: (question: string) => void
  bestSan: string | null
  secondSan: string | null
  /** SAN of the move the game actually played from this position, if any. */
  gameMoveSan: string | null
}

function quickQuestions({ bestSan, secondSan, gameMoveSan }: Omit<ChatPanelProps, 'turns' | 'onAsk'>): string[] {
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
  const score = move.mate !== null || move.evaluation !== null ? formatScore(move) : ''
  const source = move.source === 'multipv' ? `Engine 第 ${move.multipv_rank} 候選` : move.source === 'rules' ? '規則判定' : 'Engine 重新分析'
  return `${name}：${score}（${source}，白方視角）`
}

/** "Ask about this position": quick questions and free questions share one backend pipeline. */
export function ChatPanel(props: ChatPanelProps) {
  const { turns, onAsk } = props
  const [text, setText] = useState('')
  const pending = turns.some((t) => t.pending)
  const chat = turns.filter((t) => t.question !== null)

  const send = (question: string) => {
    if (!question.trim() || pending) return
    onAsk(question.trim())
    setText('')
  }

  return (
    <section className="panel chat" data-testid="chat">
      <h2>Ask about this position</h2>
      <div className="quick-questions">
        {quickQuestions(props).map((q) => (
          <button key={q} className="chip" disabled={pending} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <ol className="chat-turns">
        {chat.map((turn) => (
          <li key={turn.id} className="chat-turn">
            <div className="chat-question">{turn.question}</div>
            {turn.answer && turn.answer.checked_moves.length > 0 && (
              <ul className="checked-moves" data-testid="checked-moves">
                {turn.answer.checked_moves.map((m) => (
                  <li key={m.input} className={m.legal ? 'legal' : 'illegal'}>
                    {checkedText(m)}
                  </li>
                ))}
              </ul>
            )}
            <AnswerView turn={turn} />
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
        <button type="submit" disabled={pending || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}

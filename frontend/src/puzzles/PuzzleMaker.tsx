import { useEffect, useState } from 'react'
import type { AiChoiceView } from '../aiChoice'
import { api } from '../api'
import { AiSettings } from '../components/AiSettings'
import { puzzleLink } from '../route'
import { PUZZLE_TYPE_NAMES, type PuzzleJob, type PuzzleType } from '../types'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const POLL_MS = 1500
type Mode = 'curate' | 'design'
const COUNTS: Record<Mode, number[]> = { curate: [3, 5, 10, 20], design: [1, 2, 3, 5] }
const SHOWN_LOG = 8

/** Making new puzzles with an agent, and adding a pasted position. `onChanged`: the library grew. */
export function PuzzleMaker({ ai, onChanged }: { ai: AiChoiceView; onChanged: () => void }) {
  const [fen, setFen] = useState('')
  const [type, setType] = useState<PuzzleType>('attack')
  const [added, setAdded] = useState<string | null>(null)
  const [addedId, setAddedId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<Mode>('curate')
  const [designType, setDesignType] = useState<PuzzleType>('attack')
  const [description, setDescription] = useState('')
  const [count, setCount] = useState(5)
  const [job, setJob] = useState<PuzzleJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!job || job.status !== 'running') return
    const timer = setTimeout(async () => {
      try {
        const latest = await api.puzzleJob(job.job_id)
        setJob(latest)
        if (latest.status !== 'running') onChanged()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [job, onChanged])

  const generate = async () => {
    setError(null)
    try {
      setJob(
        await api.generatePuzzles({ mode, count, types: TYPES, type: designType, description: description.trim(), llm: ai.choice }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const add = async () => {
    setAdding(true)
    setAdded('engine 檢查中…')
    setAddedId(null)
    try {
      const puzzle = await api.createPuzzle(fen.trim(), [], type)
      setAdded(`已新增${puzzle.type_name} #${puzzle.id}（${puzzle.solver_moves ? `${puzzle.solver_moves} 步，` : ''}題目 rating ${puzzle.rating}）`)
      setAddedId(puzzle.id)
      setFen('')
      onChanged()
    } catch (e) {
      setAdded(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const running = job?.status === 'running'
  return (
    <section className="panel puzzle-maker-panel" data-testid="puzzle-maker-panel">
      <div className="puzzle-make" data-testid="puzzle-make">
        <h3>AI 製題</h3>
        <AiSettings ai={ai} />
        <div className="puzzle-modes" role="radiogroup" aria-label="製題方式">
          <label>
            <input
              type="radio"
              name="make-mode"
              checked={mode === 'curate'}
              onChange={() => {
                setMode('curate')
                setCount(5)
              }}
            />
            agent 挑題並撰寫題目
          </label>
          <label>
            <input
              type="radio"
              name="make-mode"
              checked={mode === 'design'}
              onChange={() => {
                setMode('design')
                setCount(1)
              }}
            />
            agent 設計局面
          </label>
        </div>
        {mode === 'design' && (
          <div className="puzzle-generate">
            <select aria-label="設計題型" value={designType} onChange={(e) => setDesignType(e.target.value as PuzzleType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {PUZZLE_TYPE_NAMES[t]}
                </option>
              ))}
            </select>
            <input
              aria-label="題目描述"
              placeholder="想要的題目（可留空），例如：用馬打入的防守題"
              value={description}
              maxLength={300}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        )}
        <div className="puzzle-generate">
          <select aria-label="製造題數" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS[mode].map((n) => (
              <option key={n} value={n}>
                {n} 題
              </option>
            ))}
          </select>
          <button onClick={() => void generate()} disabled={running}>
            開始製造
          </button>
        </div>
        <p className="muted">
          {mode === 'curate'
            ? '挑題：engine 自我對弈找出有唯一解的候選，agent 以人的眼光挑出最傷腦筋的題目，並寫標題、不洩題的提示與解題後的說明。'
            : '設計：agent 依題型與描述設計局面，engine 驗證合法與唯一解；不合格會把原因告訴 agent 重試（每題最多 4 次）。'}
          正確答案一律由 engine 決定；同一時間只跑一批。
        </p>
        {job && (
          <div className="engine-note" data-testid="puzzle-job">
            {job.status === 'running'
              ? job.kind === 'generate'
                ? `製造中（${job.ai || 'engine'}）：${job.done}/${job.total}，已找到 ${job.found} 題…`
                : `挖題中：${job.done}/${job.total} 個局面…`
              : job.status === 'done'
                ? `完成：${job.message}`
                : `失敗：${job.message}`}
            {job.made.length > 0 && (
              <ul className="made-puzzles" data-testid="made-puzzles">
                {job.made.map((p) => (
                  <li key={p.id}>
                    <a href={puzzleLink(p.id)}>
                      #{p.id} {p.type_name}
                      {p.title ? `・${p.title}` : ''}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {job.log.length > 0 && (
              <ol className="job-log" data-testid="puzzle-job-log">
                {job.log.slice(-SHOWN_LOG).map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        {error && <div className="engine-error">{error}</div>}
      </div>

      <h3>貼上局面新增</h3>
      <form
        className="puzzle-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (fen.trim()) void add()
        }}
      >
        <input
          aria-label="題目 FEN"
          placeholder="貼上局面 FEN（pocket 用 [..] 或 lichess 的 /.. 寫法皆可）"
          value={fen}
          onChange={(e) => setFen(e.target.value)}
        />
        <select aria-label="新增的題型" value={type} onChange={(e) => setType(e.target.value as PuzzleType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {PUZZLE_TYPE_NAMES[t]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={adding || !fen.trim()}>
          新增題目
        </button>
      </form>
      {added && (
        <div className="engine-note" data-testid="puzzle-added">
          {added}
          {addedId !== null && (
            <>
              {' '}
              <a href={puzzleLink(addedId)}>開啟這一題</a>
            </>
          )}
        </div>
      )}
      <p className="muted">挖題：在「復盤」頁載入對局後，按 FEN 下方的「從這盤挖題」。</p>
    </section>
  )
}

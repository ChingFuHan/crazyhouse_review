import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { PUZZLE_TYPE_NAMES, type PuzzleJob, type PuzzleStats, type PuzzleType } from '../types'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const POLL_MS = 1500

/** How many puzzles there are; adding a position as a puzzle; making new ones from self-play. */
export function PuzzleLibrary() {
  const [stats, setStats] = useState<PuzzleStats | null>(null)
  const [fen, setFen] = useState('')
  const [type, setType] = useState<PuzzleType>('attack')
  const [added, setAdded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [count, setCount] = useState(5)
  const [job, setJob] = useState<PuzzleJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.puzzleStats().then(setStats, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(refresh, [refresh])

  useEffect(() => {
    if (!job || job.status !== 'running') return
    const timer = setTimeout(async () => {
      try {
        const latest = await api.puzzleJob(job.job_id)
        setJob(latest)
        if (latest.status !== 'running') refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [job, refresh])

  const generate = async () => {
    setError(null)
    try {
      setJob(await api.generatePuzzles(count, TYPES))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const add = async () => {
    setAdding(true)
    setAdded('engine 檢查中…')
    try {
      const puzzle = await api.createPuzzle(fen.trim(), [], type)
      setAdded(`已新增${puzzle.type_name} #${puzzle.id}（${puzzle.solver_moves ? `${puzzle.solver_moves} 步，` : ''}題目 rating ${puzzle.rating}）`)
      setFen('')
      refresh()
    } catch (e) {
      setAdded(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const running = job?.status === 'running'
  return (
    <section className="panel puzzle-library" data-testid="puzzle-library">
      <h2>題庫</h2>
      {stats && (
        <p data-testid="puzzle-stats">
          共 {stats.total} 題：
          {TYPES.map((t) => `${PUZZLE_TYPE_NAMES[t]} ${stats.by_type[t]}`).join('、')}
        </p>
      )}
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
        </div>
      )}
      <div className="puzzle-generate">
        <label>
          製造新題
          <select aria-label="製造題數" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n} 題
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void generate()} disabled={running}>
          開始製造
        </button>
      </div>
      <p className="muted">
        新增：engine 會檢查局面是否符合題型（不符合時說明原因）。製造：engine 從常見開局自我對弈、偶爾犯人類會犯的錯，再挑出人最容易看漏的局面（每題約需數分鐘）。挖題：在「復盤」頁載入對局後，按 FEN 下方的「從這盤挖題」。
      </p>
      {job && (
        <div className="engine-note" data-testid="puzzle-job">
          {job.status === 'running'
            ? job.kind === 'generate'
              ? `製造中：第 ${job.done}/${job.total} 盤自我對弈，已找到 ${job.found} 題…`
              : `挖題中：${job.done}/${job.total} 個局面…`
            : job.status === 'done'
              ? `完成：${job.message}`
              : `失敗：${job.message}`}
        </div>
      )}
      {error && <div className="engine-error">{error}</div>}
    </section>
  )
}

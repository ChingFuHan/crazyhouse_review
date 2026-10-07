import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { PUZZLE_TYPE_NAMES, type PuzzleJob, type PuzzleStats, type PuzzleType } from '../types'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const POLL_MS = 1500

/** How many puzzles there are, and making new ones from imperfect engine self-play. */
export function PuzzleLibrary() {
  const [stats, setStats] = useState<PuzzleStats | null>(null)
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
        製造：engine 從常見開局自我對弈、偶爾犯人類會犯的錯，再挑出人最容易看漏的局面（每題約需數分鐘）。挖題：在「復盤」頁載入對局後，按「整局分析」旁的「從這盤挖題」。
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

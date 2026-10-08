import { useEffect, useState } from 'react'
import { api } from '../api'
import { type GameTree, mainline } from '../tree'
import { PUZZLE_TYPE_NAMES, type PositionState, type PuzzleJob, type PuzzleType } from '../types'

const TYPES: PuzzleType[] = ['attack', 'defense', 'tactics', 'battle']
const POLL_MS = 1500

/** Review page → puzzle page: save the position on the board as a puzzle, or mine the whole game. */
export function PuzzleTools({ tree, position }: { tree: GameTree; position: PositionState }) {
  const [type, setType] = useState<PuzzleType>('attack')
  const [message, setMessage] = useState<string | null>(null)
  const [job, setJob] = useState<PuzzleJob | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!job || job.status !== 'running') return
    const timer = setTimeout(() => {
      api.puzzleJob(job.job_id).then(setJob, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [job])

  const save = async () => {
    setSaving(true)
    setMessage('engine 檢查中…')
    try {
      const puzzle = await api.createPuzzle(position.root_fen, position.moves, type)
      setMessage(`已存成${puzzle.type_name} #${puzzle.id}（${puzzle.solver_moves ? `${puzzle.solver_moves} 步，` : ''}題目 rating ${puzzle.rating}）`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const mine = async () => {
    const last = tree.nodes[mainline(tree).at(-1)!].state
    const label = [tree.headers.White, tree.headers.Black].filter(Boolean).join(' – ')
    try {
      setJob(await api.minePuzzles(last, label))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="puzzle-tools" data-testid="puzzle-tools">
      <label>
        這個局面
        <select aria-label="題型" value={type} onChange={(e) => setType(e.target.value as PuzzleType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {PUZZLE_TYPE_NAMES[t]}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => void save()} disabled={saving}>
        存成題目
      </button>
      <button onClick={() => void mine()} disabled={job?.status === 'running'}>
        從這盤挖題
      </button>
      {message && <div className="engine-note">{message}</div>}
      {job && (
        <div className="engine-note" data-testid="mine-job">
          {job.status === 'running'
            ? `挖題中：${job.done}/${job.total} 個局面…`
            : job.status === 'done'
              ? <>挖題完成：{job.message}。<a href="#/puzzles">到題目頁</a></>
              : `挖題失敗：${job.message}`}
        </div>
      )}
    </div>
  )
}

// Learning from one side's mistakes (as lichess's "Learn from your mistakes"): go to the position
// before each mistake of the whole-game review and look for a better move; the engine judges each try.
// Tries never enter the game tree: the board snaps back, an arrow shows the move found or the answer.

import { useCallback, useMemo, useState } from 'react'
import { api } from './api'
import { LABEL } from './reviewText'
import type { GameTree } from './tree'
import type { Color, MoveClassification, MoveModel, PositionState, ReviewJob } from './types'

/** The review verdicts worth practising (inaccuracies are left out, as on lichess). */
const PRACTISED: MoveClassification[] = ['mistake', 'blunder', 'mate_missed', 'mate_allowed']

export interface LearnItem {
  /** The position to find a better move in (before the mistake). */
  beforeId: string
  mistakeId: string
  /** "12…Qxd2", the move actually played. */
  played: string
  classification: MoveClassification
  bestSan: string | null
}

export type LearnStatus = 'trying' | 'judging' | 'good' | 'answer'

export interface Learn {
  side: Color | null
  items: LearnItem[]
  index: number
  status: LearnStatus
  message: string | null
  /** The move found, or the answer, to draw on the board. */
  arrow: MoveModel | null
  solved: number
  done: boolean
  start: (side: Color) => void
  stop: () => void
  next: () => void
  showAnswer: () => Promise<void>
  /** True while the board is on the current exercise: moves there are tries. */
  onExercise: (activeId: string) => boolean
  /** A try on the board: always false (the board snaps back). */
  attempt: (position: PositionState, uci: string) => Promise<boolean>
}

const percent = (chances: number) => `${Math.round(((chances + 1) / 2) * 100)}%`

export function moveLabel(tree: GameTree, id: string): string {
  const node = tree.nodes[id]
  const blackMoved = node.state.side_to_move === 'white'
  return `${blackMoved ? node.state.move_number - 1 : node.state.move_number}${blackMoved ? '…' : '.'}${node.state.last_move?.san ?? ''}`
}

export function learnItems(tree: GameTree, job: ReviewJob, side: Color): LearnItem[] {
  return job.plies.flatMap((ply) => {
    const node = tree.nodes[ply.position_id]
    if (!node || !node.parentId || !ply.classification || !PRACTISED.includes(ply.classification)) return []
    const mover: Color = node.state.side_to_move === 'white' ? 'black' : 'white'
    if (mover !== side) return []
    return [
      {
        beforeId: node.parentId,
        mistakeId: node.id,
        played: moveLabel(tree, node.id),
        classification: ply.classification,
        bestSan: ply.best_before,
      },
    ]
  })
}

export function useLearn(tree: GameTree | null, job: ReviewJob | null, select: (id: string) => void): Learn {
  const [side, setSide] = useState<Color | null>(null)
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState<LearnStatus>('trying')
  const [message, setMessage] = useState<string | null>(null)
  const [arrow, setArrow] = useState<MoveModel | null>(null)
  const [solved, setSolved] = useState(0)

  const items = useMemo(() => (tree && job && side ? learnItems(tree, job, side) : []), [tree, job, side])
  const item: LearnItem | undefined = items[index]
  const done = side !== null && index >= items.length

  const goTo = useCallback(
    (at: number, list: LearnItem[]) => {
      setIndex(at)
      setStatus('trying')
      setArrow(null)
      setMessage(null)
      if (list[at]) select(list[at].beforeId)
    },
    [select],
  )

  const start = useCallback(
    (chosen: Color) => {
      if (!tree || !job) return
      setSide(chosen)
      setSolved(0)
      goTo(0, learnItems(tree, job, chosen))
    },
    [tree, job, goTo],
  )
  const stop = useCallback(() => {
    setSide(null)
    setArrow(null)
    setMessage(null)
  }, [])
  const next = useCallback(() => goTo(index + 1, items), [goTo, index, items])

  const showAnswer = useCallback(async () => {
    if (!tree || !item?.bestSan) return
    try {
      const after = await api.move(tree.nodes[item.beforeId].state, item.bestSan)
      setArrow(after.last_move)
      setStatus('answer')
      setMessage(`答案：${item.bestSan}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }, [tree, item])

  const onExercise = useCallback((activeId: string) => side !== null && !!item && activeId === item.beforeId, [side, item])

  const attempt = useCallback(
    async (position: PositionState, uci: string) => {
      if (!item || status === 'judging') return false
      setStatus('judging')
      setMessage('engine 判定中…')
      try {
        const judged = await api.judgeMove(position, uci)
        if (judged.verdict === null) {
          setStatus('good')
          setArrow(judged.played)
          if (status === 'trying') setSolved((n) => n + 1)
          const best = judged.best && judged.best.uci !== judged.played.uci ? `（engine 最佳：${judged.best.san}）` : ''
          setMessage(`好著！${judged.played.san}${best}`)
        } else {
          setStatus('trying')
          setArrow(null)
          setMessage(
            `${judged.played.san} 還不夠好（${LABEL[judged.verdict]}：勝率 ${percent(judged.chances_played)}，最佳可達 ${percent(judged.chances_best)}），再試一次或看答案`,
          )
        }
      } catch (e) {
        setStatus('trying')
        setMessage(e instanceof Error ? e.message : String(e))
      }
      return false
    },
    [item, status],
  )

  return { side, items, index, status, message, arrow, solved, done, start, stop, next, showAnswer, onExercise, attempt }
}

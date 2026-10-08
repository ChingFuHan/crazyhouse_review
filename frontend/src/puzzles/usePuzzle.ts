// One puzzle at a time: fetch, judge moves on the server (it holds the solution), battles, hints.
// The board always shows a position the backend built from the puzzle FEN + the line played so far
// (from the position before the opponent's last move, when known, so that move stays highlighted).

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type {
  AnswerWarning,
  BattleMoveResult,
  HintLevel,
  LlmChoice,
  MoveModel,
  PositionState,
  PuzzleHint,
  PuzzleMoveResult,
  PuzzleType,
  PuzzleView,
  RatingChange,
} from '../types'

export type PuzzleStatus =
  | 'idle'
  | 'loading'
  | 'intro' // the opponent's last move is being shown
  | 'solving'
  | 'thinking'
  | 'solved'
  | 'failed'
  | 'finished'
  | 'error'

export interface PuzzleState {
  puzzle: PuzzleView | null
  position: PositionState | null
  line: string[]
  status: PuzzleStatus
  message: string | null
  solution: MoveModel[]
  /** The solution and explanation are shown (solved, or the viewer asked after failing). */
  revealed: boolean
  /** Playing on after a failure: never rated. */
  retrying: boolean
  rating: RatingChange | null
  hint: PuzzleHint | null
  /** This step's hint on screen: 1 the agent's words, 2 also the piece to move. */
  hintLevel: HintLevel
  /** The most this puzzle's hints showed (it decides the score). */
  hintUsed: HintLevel
  /** The agent's explanation, once the puzzle is over. */
  explanation: string
  aiWarnings: AnswerWarning[]
  /** The agent asked to explain the puzzle, while it writes. */
  explaining: string | null
  /** Battle: one entry per solver move. */
  battle: BattleMoveResult[]
}

const EMPTY: PuzzleState = {
  puzzle: null,
  position: null,
  line: [],
  status: 'idle',
  message: null,
  solution: [],
  revealed: false,
  retrying: false,
  rating: null,
  hint: null,
  hintLevel: 0,
  hintUsed: 0,
  explanation: '',
  aiWarnings: [],
  explaining: null,
  battle: [],
}

// The opponent's last move is played this long after the puzzle appears; its replies this long after
// the solver's move, so both can be seen.
export const INTRO_MS = 600
export const REPLY_MS = 500

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The board after `line`, played from before the opponent's last move when the puzzle knows it. */
function positionAfter(puzzle: PuzzleView, line: string[]): Promise<PositionState> {
  return puzzle.before_fen && puzzle.last_move
    ? api.position(puzzle.before_fen, [puzzle.last_move, ...line])
    : api.position(puzzle.fen, line)
}

const SOLVED: Record<HintLevel, string> = {
  0: '解出來了！',
  1: '解出來了（用了文字提示，算半分）',
  2: '解出來了（看了要動的棋子，不計為解出）',
}

export function usePuzzle(nickname: string | null, onRated: (rating: number) => void) {
  const [state, setState] = useState<PuzzleState>(EMPTY)
  const current = useRef(state)
  useEffect(() => {
    current.current = state
  }, [state])
  const generation = useRef(0)

  const update = (patch: Partial<PuzzleState>) => setState((s) => ({ ...s, ...patch }))

  const load = useCallback(
    async (fetch: (player: string) => Promise<PuzzleView>) => {
      if (!nickname) return
      const mine = ++generation.current
      setState({ ...EMPTY, status: 'loading' })
      try {
        const puzzle = await fetch(nickname)
        if (puzzle.before_fen && puzzle.last_move) {
          const before = await api.position(puzzle.before_fen, [])
          if (mine !== generation.current) return
          setState({ ...EMPTY, puzzle, position: before, status: 'intro' })
          await pause(INTRO_MS)
        }
        const position = await positionAfter(puzzle, [])
        if (mine === generation.current) setState({ ...EMPTY, puzzle, position, status: 'solving' })
      } catch (e) {
        if (mine === generation.current) setState({ ...EMPTY, status: 'error', message: errorText(e) })
      }
    },
    [nickname],
  )
  /** A puzzle of `types` close to the player's rating. */
  const next = useCallback((types: PuzzleType[]) => load((player) => api.nextPuzzle(player, types)), [load])
  /** A given puzzle (a link to it). */
  const open = useCallback((id: number) => load((player) => api.openPuzzle(id, player)), [load])

  const finish = useCallback(
    (rating: RatingChange | null) => {
      if (rating?.rated) onRated(rating.after)
    },
    [onRated],
  )

  /** The solver's move stays on the board for REPLY_MS before the reply is played. */
  const showReply = async (puzzle: PuzzleView, played: string[], replied: string[], mine: number) => {
    update({ position: await positionAfter(puzzle, played) })
    await pause(REPLY_MS)
    const position = await positionAfter(puzzle, replied)
    return mine === generation.current ? position : null
  }

  const ended = (s: PuzzleState, result: PuzzleMoveResult): Partial<PuzzleState> => {
    if (result.correct) {
      return {
        status: 'solved',
        revealed: true,
        message: s.retrying ? '解出來了（重試，不計分）' : SOLVED[s.hintUsed],
      }
    }
    return {
      status: 'failed',
      revealed: false,
      message: `${result.played?.san} 不是答案${result.rating?.rated ? '（已記為失敗）' : ''}`,
    }
  }

  /** A move on the board: true keeps it there, false snaps the board back. */
  const play = useCallback(
    async (uci: string): Promise<boolean> => {
      const s = current.current
      if (!nickname || !s.puzzle || s.status !== 'solving') return false
      const puzzle = s.puzzle
      const mine = generation.current
      update({ status: 'thinking', hint: null, hintLevel: 0 })
      try {
        if (puzzle.type === 'battle') {
          const result = await api.battleMove(puzzle.id, nickname, s.line, uci)
          const played = [...s.line, result.played.uci]
          const line = [...played, ...(result.reply ? [result.reply.uci] : [])]
          const position = await showReply(puzzle, played, line, mine)
          if (!position) return false
          finish(result.rating)
          update({
            line,
            position,
            battle: [...s.battle, result],
            status: result.done ? 'finished' : 'solving',
            revealed: result.done,
            rating: result.rating,
            explanation: result.explanation,
            aiWarnings: result.ai_warnings,
            message: result.done ? null : `還有 ${result.moves_left} 步`,
          })
          return true
        }
        const result = await api.puzzleMove(puzzle.id, nickname, s.line, uci, s.hintUsed)
        if (mine !== generation.current) return false
        if (result.alternative) {
          update({ status: 'solving', message: `${result.played?.san} 也是好著（engine 評估相近），但不是這題要找的答案，再想想` })
          return false
        }
        const played = [...s.line, ...(result.played ? [result.played.uci] : [])]
        if (!result.done) {
          const line = [...played, ...(result.reply ? [result.reply.uci] : [])]
          const position = await showReply(puzzle, played, line, mine)
          if (!position) return false
          update({ line, position, status: 'solving', message: `正確！對手回應 ${result.reply?.san}，繼續` })
          return true
        }
        const position = await positionAfter(puzzle, played)
        if (mine !== generation.current) return false
        finish(result.rating)
        update({
          line: played,
          position,
          solution: result.solution,
          rating: s.retrying ? s.rating : result.rating,
          explanation: result.explanation,
          aiWarnings: result.ai_warnings,
          ...ended(s, result),
        })
        return true
      } catch (e) {
        if (mine === generation.current) update({ status: 'solving', message: errorText(e) })
        return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nickname, finish],
  )

  /** After a failure: back to before the wrong move, to keep looking (not rated). */
  const retry = useCallback(async () => {
    const s = current.current
    if (!s.puzzle || s.status !== 'failed') return
    const line = s.line.slice(0, -1)
    update({ line, position: await positionAfter(s.puzzle, line), status: 'solving', retrying: true, message: '再試一次（不計分）' })
  }, [])

  const reveal = useCallback(() => update({ revealed: true }), [])

  const hint = useCallback(async () => {
    const s = current.current
    if (!s.puzzle || s.puzzle.type === 'battle' || s.status !== 'solving') return
    try {
      if (s.hint && s.hintLevel === 1) {
        update({ hintLevel: 2, hintUsed: 2 })
        return
      }
      const hint = await api.puzzleHint(s.puzzle.id, s.line)
      const level: HintLevel = hint.text ? 1 : 2
      update({ hint, hintLevel: level, hintUsed: Math.max(s.hintUsed, level) as HintLevel })
    } catch (e) {
      update({ message: errorText(e) })
    }
  }, [])

  const giveUp = useCallback(async () => {
    const s = current.current
    if (!nickname || !s.puzzle || s.puzzle.type === 'battle') return
    try {
      const result = await api.giveUp(s.puzzle.id, nickname)
      finish(result.rating)
      update({
        status: 'failed',
        revealed: true,
        solution: result.solution,
        rating: s.retrying ? s.rating : result.rating,
        explanation: result.explanation,
        aiWarnings: result.ai_warnings,
        message: '看了解答',
      })
    } catch (e) {
      update({ message: errorText(e) })
    }
  }, [nickname, finish])

  /** Step through the solution on the board after the puzzle is over. */
  const showSolution = useCallback(async (plies: number) => {
    const s = current.current
    if (!s.puzzle) return
    const line = s.solution.slice(0, plies).map((m) => m.uci)
    update({ line, position: await positionAfter(s.puzzle, line) })
  }, [])

  /** Ask the chosen agent to explain the puzzle (once it is over); the answer is stored for everyone. */
  const explain = useCallback(
    async (llm: LlmChoice | null, label: string) => {
      const s = current.current
      if (!nickname || !s.puzzle) return
      const mine = generation.current
      update({ explaining: label, message: null })
      try {
        const texts = await api.explainPuzzle(s.puzzle.id, nickname, llm)
        if (mine !== generation.current) return
        setState((now) => ({
          ...now,
          explaining: null,
          explanation: texts.explanation,
          aiWarnings: texts.ai_warnings,
          puzzle: now.puzzle && { ...now.puzzle, title: texts.title, ai: texts.ai },
        }))
      } catch (e) {
        if (mine === generation.current) update({ explaining: null, message: errorText(e) })
      }
    },
    [nickname],
  )

  return { state, next, open, play, retry, reveal, hint, giveUp, showSolution, explain }
}

// One puzzle at a time: fetch, judge moves on the server (it holds the solution), battles, hints.
// The board always shows a position the backend built from the puzzle FEN + the line played so far.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type {
  AnswerWarning,
  BattleMoveResult,
  MoveModel,
  PositionState,
  PuzzleHint,
  PuzzleType,
  PuzzleView,
  RatingChange,
} from '../types'

export type PuzzleStatus = 'idle' | 'loading' | 'solving' | 'thinking' | 'solved' | 'failed' | 'finished' | 'error'

export interface PuzzleState {
  puzzle: PuzzleView | null
  position: PositionState | null
  line: string[]
  status: PuzzleStatus
  message: string | null
  solution: MoveModel[]
  rating: RatingChange | null
  hint: PuzzleHint | null
  /** 1: the agent's words only; 2: also the piece to move. */
  hintLevel: 0 | 1 | 2
  hintUsed: boolean
  /** The agent's explanation, once the puzzle is over. */
  explanation: string
  aiWarnings: AnswerWarning[]
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
  rating: null,
  hint: null,
  hintLevel: 0,
  hintUsed: false,
  explanation: '',
  aiWarnings: [],
  battle: [],
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

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
        const position = await api.position(puzzle.fen, [])
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

  /** A move on the board: true keeps it there, false snaps the board back. */
  const play = useCallback(
    async (uci: string): Promise<boolean> => {
      const s = current.current
      if (!nickname || !s.puzzle || s.status !== 'solving') return false
      const mine = generation.current
      update({ status: 'thinking', hint: null, hintLevel: 0 })
      try {
        if (s.puzzle.type === 'battle') {
          const result = await api.battleMove(s.puzzle.id, nickname, s.line, uci)
          const line = [...s.line, result.played.uci, ...(result.reply ? [result.reply.uci] : [])]
          const position = await api.position(s.puzzle.fen, line)
          if (mine !== generation.current) return false
          finish(result.rating)
          update({
            line,
            position,
            battle: [...s.battle, result],
            status: result.done ? 'finished' : 'solving',
            rating: result.rating,
            explanation: result.explanation,
            aiWarnings: result.ai_warnings,
            message: result.done ? null : `還有 ${result.moves_left} 步`,
          })
          return true
        }
        const result = await api.puzzleMove(s.puzzle.id, nickname, s.line, uci, s.hintUsed)
        if (mine !== generation.current) return false
        const played = result.played ? [result.played.uci] : []
        const line = result.correct ? [...s.line, ...played, ...(result.reply ? [result.reply.uci] : [])] : [...s.line, ...played]
        const position = await api.position(s.puzzle.fen, line)
        if (mine !== generation.current) return false
        if (result.done) finish(result.rating)
        update({
          line,
          position,
          solution: result.solution,
          rating: result.rating,
          explanation: result.explanation,
          aiWarnings: result.ai_warnings,
          status: result.done ? (result.correct ? 'solved' : 'failed') : 'solving',
          message: result.done
            ? result.correct
              ? s.hintUsed
                ? '解出來了（用了提示，不計為解出）'
                : '解出來了！'
              : `${result.played?.san} 不是答案`
            : `正確！對手回應 ${result.reply?.san}，繼續`,
        })
        return true
      } catch (e) {
        if (mine === generation.current) update({ status: 'solving', message: errorText(e) })
        return false
      }
    },
    [nickname, finish],
  )

  const hint = useCallback(async () => {
    const s = current.current
    if (!s.puzzle || s.puzzle.type === 'battle' || s.status !== 'solving') return
    try {
      if (s.hint && s.hintLevel === 1) {
        update({ hintLevel: 2 })
        return
      }
      const hint = await api.puzzleHint(s.puzzle.id, s.line)
      update({ hint, hintLevel: hint.text ? 1 : 2, hintUsed: true })
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
        solution: result.solution,
        rating: result.rating,
        explanation: result.explanation,
        aiWarnings: result.ai_warnings,
        message: '看了解答',
      })
    } catch (e) {
      update({ message: errorText(e) })
    }
  }, [nickname, finish])

  /** Step through the solution on the board after the puzzle is over. */
  const showSolution = useCallback(
    async (plies: number) => {
      const s = current.current
      if (!s.puzzle) return
      const line = s.solution.slice(0, plies).map((m) => m.uci)
      update({ line, position: await api.position(s.puzzle.fen, line) })
    },
    [],
  )

  return { state, next, open, play, hint, giveUp, showSolution }
}

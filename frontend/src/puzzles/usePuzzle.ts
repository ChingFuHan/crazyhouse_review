// One puzzle at a time: fetch, judge moves on the server (it holds the solution), battles, hints.
// The board shows a position the backend built from the puzzle's root and a cursor into the moves
// played (from the position before the opponent's last move, when known, so that move can be replayed
// and stays highlighted). The cursor moves freely; once the puzzle is over the whole puzzle replays.

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
import type { NavKind } from '../useReview'

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
  /** The moves played so far from the puzzle position (opponent replies and a wrong move included). */
  line: string[]
  /** `line` in SAN, to list the moves actually played. */
  lineSan: string[]
  /** How many of `line` are known right (a prefix of the solution). */
  correct: number
  /** The board shows the first `cursor` moves of the replay track (see `replayTrack`). */
  cursor: number
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
  lineSan: [],
  correct: 0,
  cursor: 0,
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

/** 1 when the puzzle knows the opponent's last move: the track starts one move earlier. */
export const introOf = (puzzle: PuzzleView): number => (puzzle.before_fen && puzzle.last_move ? 1 : 0)

/** The moves the board steps through from the root: the opponent's last move (if known), then the
 * moves played — or, after a failure once the answer is shown, the solution. */
export function replayTrack(s: Pick<PuzzleState, 'puzzle' | 'line' | 'solution' | 'revealed' | 'status'>): string[] {
  const puzzle = s.puzzle!
  const moves = s.revealed && s.status === 'failed' ? s.solution.map((m) => m.uci) : s.line
  return introOf(puzzle) ? [puzzle.last_move, ...moves] : moves
}

function positionAt(puzzle: PuzzleView, track: string[], cursor: number): Promise<PositionState> {
  return api.position(introOf(puzzle) ? puzzle.before_fen : puzzle.fen, track.slice(0, cursor))
}

const SOLVED: Record<HintLevel, string> = {
  0: '解出來了！',
  1: '解出來了（用了文字提示，算半分）',
  2: '解出來了（看了要動的棋子，不計為解出）',
}

const BUSY: PuzzleStatus[] = ['idle', 'loading', 'intro', 'thinking', 'error']

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
        const offset = introOf(puzzle)
        if (offset) {
          const before = await positionAt(puzzle, [puzzle.last_move], 0)
          if (mine !== generation.current) return
          setState({ ...EMPTY, puzzle, position: before, status: 'intro' })
          await pause(INTRO_MS)
        }
        const position = await positionAt(puzzle, offset ? [puzzle.last_move] : [], offset)
        if (mine === generation.current) setState({ ...EMPTY, puzzle, position, cursor: offset, status: 'solving' })
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
  const showReply = async (puzzle: PuzzleView, line: string[], mine: number): Promise<PositionState | null> => {
    const track = introOf(puzzle) ? [puzzle.last_move, ...line] : line
    update({ position: await positionAt(puzzle, track, track.length - 1) })
    await pause(REPLY_MS)
    const position = await positionAt(puzzle, track, track.length)
    return mine === generation.current ? position : null
  }

  const ended = (retrying: boolean, hintUsed: HintLevel, result: PuzzleMoveResult): Partial<PuzzleState> => {
    if (result.correct) {
      return { status: 'solved', revealed: true, message: retrying ? '解出來了（重試，不計分）' : SOLVED[hintUsed] }
    }
    return {
      status: 'failed',
      revealed: false,
      message: `${result.played?.san} 不是答案${result.rating?.rated ? '（已記為失敗）' : ''}。按 ◀ 回上一步再試（不計分），或看解答`,
    }
  }

  /** A move on the board at the cursor: true keeps it there, false snaps the board back. */
  const play = useCallback(
    async (uci: string): Promise<boolean> => {
      const s = current.current
      if (!nickname || !s.puzzle || s.status !== 'solving') return false
      const puzzle = s.puzzle
      const offset = introOf(puzzle)
      const step = s.cursor - offset // moves played before the board's position
      if (step < 0) return false // the position before the opponent's last move
      const mine = generation.current
      try {
        if (puzzle.type === 'battle') {
          if (step !== s.line.length) {
            update({ message: '按 ⏭ 回到目前局面再走' })
            return false
          }
          update({ status: 'thinking' })
          const result = await api.battleMove(puzzle.id, nickname, s.line, uci)
          const line = [...s.line, result.played.uci, ...(result.reply ? [result.reply.uci] : [])]
          const lineSan = [...s.lineSan, result.played.san, ...(result.reply ? [result.reply.san] : [])]
          const position = result.reply
            ? await showReply(puzzle, line, mine)
            : await positionAt(puzzle, introOf(puzzle) ? [puzzle.last_move, ...line] : line, offset + line.length)
          if (!position || mine !== generation.current) return false
          finish(result.rating)
          update({
            line,
            lineSan,
            correct: line.length,
            cursor: offset + line.length,
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
        if (step % 2 === 1 || step > s.correct) return false // the opponent's turn, or past a wrong move
        if (step < s.correct && s.line[step] === uci) {
          // The move already found here: step on to after the reply.
          const cursor = Math.min(offset + s.correct, s.cursor + 2)
          update({ cursor, position: await positionAt(puzzle, replayTrack(s), cursor), hint: null, hintLevel: 0 })
          return true
        }
        const prefix = s.line.slice(0, step)
        update({ status: 'thinking', hint: null, hintLevel: 0 })
        const result = await api.puzzleMove(puzzle.id, nickname, prefix, uci, s.hintUsed)
        if (mine !== generation.current) return false
        if (result.alternative) {
          update({ status: 'solving', message: `${result.played?.san} 也是好著（engine 評估相近），但不是這題要找的答案，再想想` })
          return false
        }
        const played = [...prefix, ...(result.played ? [result.played.uci] : [])]
        const playedSan = [...s.lineSan.slice(0, step), ...(result.played ? [result.played.san] : [])]
        if (!result.done) {
          const line = [...played, ...(result.reply ? [result.reply.uci] : [])]
          const position = await showReply(puzzle, line, mine)
          if (!position) return false
          update({
            line,
            lineSan: [...playedSan, ...(result.reply ? [result.reply.san] : [])],
            correct: line.length,
            cursor: offset + line.length,
            position,
            status: 'solving',
            message: `正確！對手回應 ${result.reply?.san}，繼續`,
          })
          return true
        }
        const track = introOf(puzzle) ? [puzzle.last_move, ...played] : played
        const position = await positionAt(puzzle, track, track.length)
        if (mine !== generation.current) return false
        finish(result.rating)
        update({
          line: played,
          lineSan: playedSan,
          correct: result.correct ? played.length : prefix.length,
          cursor: track.length,
          position,
          solution: result.solution,
          rating: s.retrying ? s.rating : result.rating,
          explanation: result.explanation,
          aiWarnings: result.ai_warnings,
          ...ended(s.retrying, s.hintUsed, result),
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

  /** Move the board through the puzzle (◀ ▶ ⏮ ⏭, or a ply of the solution); back from a wrong move
   * lets the solver try again (unrated). */
  const navigate = useCallback(async (to: NavKind | number) => {
    const s = current.current
    if (!s.puzzle || BUSY.includes(s.status)) return
    const track = replayTrack(s)
    const end = track.length
    const target =
      typeof to === 'number'
        ? to
        : { first: 0, prev: s.cursor - 1, next: s.cursor + 1, last: end }[to] ?? s.cursor
    const cursor = Math.max(0, Math.min(end, target))
    if (cursor === s.cursor) return
    const position = await positionAt(s.puzzle, track, cursor)
    setState((now) => {
      if (now.puzzle !== s.puzzle || BUSY.includes(now.status)) return now
      const patch: Partial<PuzzleState> = { cursor, position, hint: null, hintLevel: 0 }
      if (now.status === 'failed' && !now.revealed && cursor - introOf(now.puzzle!) <= now.correct) {
        Object.assign(patch, { status: 'solving', retrying: true, message: '再試一次（不計分）' })
      }
      return { ...now, ...patch }
    })
  }, [])

  /** Show the answer after a failure: the board goes back to the puzzle's start, to replay it. */
  const reveal = useCallback(async () => {
    const s = current.current
    if (!s.puzzle) return
    const shown = { ...s, revealed: true }
    const cursor = introOf(s.puzzle)
    update({ revealed: true, cursor, position: await positionAt(s.puzzle, replayTrack(shown), cursor) })
  }, [])

  const hint = useCallback(async () => {
    const s = current.current
    if (!s.puzzle || s.puzzle.type === 'battle' || s.status !== 'solving') return
    const step = s.cursor - introOf(s.puzzle)
    if (step < 0 || step % 2 === 1 || step > s.correct) {
      update({ message: '回到輪你走的局面再看提示' })
      return
    }
    try {
      if (s.hint && s.hintLevel === 1) {
        update({ hintLevel: 2, hintUsed: 2 })
        return
      }
      const hint = await api.puzzleHint(s.puzzle.id, s.line.slice(0, step))
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
      const over = { ...s, status: 'failed' as const, revealed: true, solution: result.solution }
      const cursor = introOf(s.puzzle)
      update({
        status: 'failed',
        revealed: true,
        solution: result.solution,
        cursor,
        position: await positionAt(s.puzzle, replayTrack(over), cursor),
        rating: s.retrying ? s.rating : result.rating,
        explanation: result.explanation,
        aiWarnings: result.ai_warnings,
        message: '看了解答：用 ◀ ▶ 逐步看',
      })
    } catch (e) {
      update({ message: errorText(e) })
    }
  }, [nickname, finish])

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

  return { state, next, open, play, navigate, reveal, hint, giveUp, explain }
}

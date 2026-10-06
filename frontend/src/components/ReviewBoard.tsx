import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawShape } from 'chessground/draw'
import { cancelDropMode, setDropMode } from 'chessground/drop'
import type { Key, MouchEvent, Role } from 'chessground/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PIECE_NAMES } from '../explain'
import { ARROW_DIRECTIONS, initialCursor, moveCursor } from '../keyboardBoard'
import { boardDests, dropSquares, promotionChoices } from '../moves'
import { letterOf, roleOf } from '../pieces'
import type { Color, PositionState } from '../types'
import { Board } from './Board'
import { PieceIcon } from './PieceIcon'
import { Pocket } from './Pocket'

export interface ReviewBoardProps {
  position: PositionState
  orientation: Color
  /** Sends a UCI move to the backend; resolves false if it was rejected. */
  onPlay: (uci: string) => Promise<boolean>
  shapes?: DrawShape[]
}

interface PendingPromotion {
  positionId: string
  orig: string
  dest: string
  choices: string[]
}

interface DropTargets {
  positionId: string
  keys: Key[]
}

/** A pocket piece picked by clicking (click-to-drop), waiting for a target square. */
interface DropSelection {
  positionId: string
  role: Role
  color: Color
}

/** Board + pockets + promotion chooser. Every move goes to the backend, the rules authority. */
export function ReviewBoard({ position, orientation, onPlay, shapes }: ReviewBoardProps) {
  const ground = useRef<Api | null>(null)
  const [syncKey, setSyncKey] = useState(0)
  // Both are tied to the position they were started on and ignored once it changes.
  const [pendingPromotion, setPromotion] = useState<PendingPromotion | null>(null)
  const [dropTargets, setDropTargets] = useState<DropTargets | null>(null)
  const [dropSelection, setDropSelection] = useState<DropSelection | null>(null)
  const dropped = useRef(false)
  const promotion = pendingPromotion?.positionId === position.position_id ? pendingPromotion : null
  const selection = dropSelection?.positionId === position.position_id ? dropSelection : null
  // Keyboard cursor (only while the board has keyboard focus) and what it announces.
  const [cursor, setCursor] = useState<Key | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const interactive = position.outcome === null && position.legal_moves.length > 0

  const resync = useCallback(() => setSyncKey((k) => k + 1), [])

  const submit = useCallback(
    async (uci: string) => {
      if (!(await onPlay(uci))) resync()
    },
    [onPlay, resync],
  )

  const movable = useMemo<Config['movable']>(
    () => ({
      free: false,
      color: interactive ? position.side_to_move : undefined,
      dests: interactive ? boardDests(position.legal_moves) : new Map(),
      showDests: true,
      events: {
        after: (orig, dest) => {
          const choices = promotionChoices(position.legal_moves, orig, dest)
          if (choices.length > 0) setPromotion({ positionId: position.position_id, orig, dest, choices })
          else void submit(orig + dest)
        },
        afterNewPiece: (role, key) => {
          dropped.current = true
          setDropTargets(null)
          setDropSelection(null)
          void submit(`${letterOf(role)}@${key}`)
        },
      },
    }),
    [position, interactive, submit],
  )

  const highlights = useMemo(() => {
    const keys =
      dropTargets?.positionId === position.position_id
        ? dropTargets.keys
        : selection
          ? dropSquares(position.legal_moves, letterOf(selection.role))
          : []
    const map = new Map(keys.map((key): [Key, string] => [key, 'drop-dest']))
    if (cursor) map.set(cursor, `${map.get(cursor) ?? ''} kb-cursor`.trim())
    return map
  }, [dropTargets, selection, position, cursor])

  const describe = (key: Key): string => {
    const piece = ground.current?.state.pieces.get(key)
    const what = piece ? `${piece.color === 'white' ? '白' : '黑'}${PIECE_NAMES[letterOf(piece.role)]}` : '空格'
    const selected = ground.current?.state.selected === key ? '，已選取' : ''
    return `${key}：${what}${selected}`
  }

  const onBoardKey = (event: React.KeyboardEvent) => {
    const here = cursor ?? initialCursor(orientation)
    const direction = ARROW_DIRECTIONS[event.key]
    if (!cursor && (direction || event.key === 'Enter' || event.key === ' ')) {
      // First key press only reveals the cursor (mouse users never see it).
      setCursor(here)
      setAnnouncement(describe(here))
    } else if (direction) {
      const next = moveCursor(here, direction, orientation)
      setCursor(next)
      setAnnouncement(describe(next))
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (selection) {
        setDropSelection(null)
        void submit(`${letterOf(selection.role)}@${here}`) // the backend decides legality
      } else {
        ground.current?.selectSquare(here)
        setAnnouncement(describe(here))
      }
    } else if (event.key === 'Escape') {
      ground.current?.selectSquare(null)
      setAnnouncement('已取消選取')
      return // let the pocket selection's own Escape handler run too
    } else {
      return
    }
    // The board owns these keys while focused (arrows do not navigate the move list here).
    event.preventDefault()
    event.stopPropagation()
  }

  // Mirror the click-to-drop selection into chessground's drop mode (it lives in its own state).
  useEffect(() => {
    const api = ground.current
    if (!api) return
    if (selection) setDropMode(api.state, { role: selection.role, color: selection.color })
    else cancelDropMode(api.state)
  }, [selection])

  useEffect(() => {
    if (!selection) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDropSelection(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const toggleSelection = (color: Color) => (role: Role) => {
    if (!interactive || color !== position.side_to_move) return
    setDropSelection(selection?.role === role ? null : { positionId: position.position_id, role, color })
  }

  // One attempt per selection: if the click on the board did not drop (e.g. occupied square),
  // leave drop mode and re-sync so chessground's off-board placeholder piece is discarded.
  const onBoardPointerDown = () => {
    refreshBounds()
    if (!selection) return
    dropped.current = false
    setTimeout(() => {
      if (dropped.current) return
      setDropSelection(null)
      resync()
    }, 0)
  }

  // Chessground caches the board rectangle and only refreshes it on scroll/resize; a layout
  // shift above the board (banner, header) would map pointer positions to the wrong square.
  const refreshBounds = useCallback(() => ground.current?.state.dom.bounds.clear(), [])

  const startPocketDrag = useCallback(
    (color: Color) => (role: Role, event: React.MouseEvent | React.TouchEvent) => {
      if (!ground.current || !interactive || color !== position.side_to_move) return
      refreshBounds()
      // No preventDefault on touchstart: the tap must still produce a click (tap-to-drop);
      // scrolling during a pocket drag is prevented by `touch-action: none` on the slot.
      setDropTargets({ positionId: position.position_id, keys: dropSquares(position.legal_moves, letterOf(role)) })
      const clear = () => setDropTargets(null)
      document.addEventListener('mouseup', clear, { once: true })
      document.addEventListener('touchend', clear, { once: true })
      ground.current.dragNewPiece({ role, color }, event.nativeEvent as unknown as MouchEvent)
    },
    [interactive, position, refreshBounds],
  )

  const choosePromotion = (letter: string | null) => {
    const pending = promotion
    setPromotion(null)
    if (pending && letter) void submit(pending.orig + pending.dest + letter.toLowerCase())
    else resync()
  }

  const top: Color = orientation === 'white' ? 'black' : 'white'
  const pocket = (color: Color) => (
    <Pocket
      color={color}
      pieces={position.pockets[color]}
      active={interactive && position.side_to_move === color}
      onDragStart={startPocketDrag(color)}
      selected={selection?.color === color ? selection.role : null}
      onSelect={toggleSelection(color)}
    />
  )

  return (
    <>
      {pocket(top)}
      <div
        className="board-wrap"
        tabIndex={0}
        role="application"
        aria-label="棋盤：方向鍵移動游標，Enter 選子或落子（已選 pocket 棋子時打入），Esc 取消"
        onMouseDownCapture={onBoardPointerDown}
        onTouchStartCapture={onBoardPointerDown}
        onKeyDown={onBoardKey}
        onBlur={() => setCursor(null)}
      >
        <div className="sr-only" aria-live="polite" data-testid="board-announcer">
          {announcement}
        </div>
        <Board
          position={position}
          orientation={orientation}
          movable={movable}
          highlights={highlights}
          syncKey={syncKey}
          shapes={shapes}
          onReady={(api) => (ground.current = api)}
        />
        {promotion && (
          <div className="promotion-overlay" onClick={() => choosePromotion(null)}>
            <div className="promotion-choices cg-wrap" role="dialog" aria-label="promotion" onClick={(e) => e.stopPropagation()}>
              {promotion.choices.map((letter) => (
                <button
                  key={letter}
                  aria-label={`promote to ${roleOf(letter)}`}
                  onClick={() => choosePromotion(letter)}
                >
                  <PieceIcon role={roleOf(letter)} color={position.side_to_move} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {pocket(orientation)}
      {selection && (
        <div className="drop-hint" role="status">
          已選 {letterOf(selection.role)}：點目標格打入，或在棋步輸入框輸入 {letterOf(selection.role)}@e4 這類寫法；Esc 取消。
        </div>
      )}
    </>
  )
}

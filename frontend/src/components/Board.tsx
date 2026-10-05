import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { useEffect, useRef } from 'react'
import type { Color, PositionState } from '../types'

export interface BoardProps {
  position: PositionState
  orientation: Color
  /** Squares/arrows drawn by the app (engine arrows, drop markers). */
  shapes?: DrawShape[]
  /** Receives the chessground API once; used for pocket drags. */
  onReady?: (api: Api) => void
  movable?: Config['movable']
}

function lastMoveKeys(position: PositionState): Key[] | undefined {
  const move = position.last_move
  if (!move) return undefined
  return (move.from ? [move.from, move.to] : [move.to]) as Key[]
}

/** Chessground view of a backend position. The board never decides legality itself. */
export function Board({ position, orientation, shapes, onReady, movable }: BoardProps) {
  const element = useRef<HTMLDivElement>(null)
  const ground = useRef<Api | null>(null)

  useEffect(() => {
    if (!element.current) return
    const api = Chessground(element.current, {
      coordinates: true,
      animation: { enabled: true, duration: 150 },
      highlight: { lastMove: true, check: true },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: true, visible: true },
      movable: { free: false, color: undefined, showDests: true },
      premovable: { enabled: false },
      predroppable: { enabled: false },
    })
    ground.current = api
    onReady?.(api)
    return () => {
      api.destroy()
      ground.current = null
    }
    // onReady is intentionally only called once per board instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ground.current?.set({
      fen: position.fen,
      orientation,
      turnColor: position.side_to_move,
      check: position.is_check ? position.side_to_move : false,
      lastMove: lastMoveKeys(position),
      movable: movable ?? { color: undefined, dests: new Map() },
    })
  }, [position, orientation, movable])

  useEffect(() => {
    ground.current?.setAutoShapes(shapes ?? [])
  }, [shapes, position])

  return <div ref={element} className="board" data-fen={position.fen} data-position-id={position.position_id} />
}

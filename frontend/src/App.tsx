import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { EnginePanel } from './components/EnginePanel'
import { MoveInput } from './components/MoveInput'
import { MoveList } from './components/MoveList'
import { NavControls } from './components/NavControls'
import { PgnLoader } from './components/PgnLoader'
import { ReviewBoard } from './components/ReviewBoard'
import { ReviewPanel } from './components/ReviewPanel'
import { WhyPanel } from './components/WhyPanel'
import { engineShapes } from './engineShapes'
import { MAIN, mainlineAncestor } from './tree'
import type { Color } from './types'
import { useBooleanPreference } from './preferences'
import { useConversation } from './useConversation'
import { useEngine } from './useEngine'
import { useGameReview } from './useGameReview'
import { useInsights } from './useInsights'
import { useReview } from './useReview'

/** Auto-explain waits until the user has stayed on a position this long after its analysis is done. */
const AUTO_EXPLAIN_DWELL_MS = 1500

export default function App() {
  const review = useReview()
  const [orientation, setOrientation] = useState<Color>('white')
  const flip = useCallback(() => setOrientation((o) => (o === 'white' ? 'black' : 'white')), [])
  const { tree, active, play, playLine } = review
  const position = active?.state
  const [engineOn, toggleEngine] = useBooleanPreference('engine-on', true)
  const [autoExplain, toggleAutoExplain] = useBooleanPreference('auto-explain', false)
  const engine = useEngine(position ?? null, engineOn)
  const insights = useInsights(position ?? null, engine)
  const conversation = useConversation(tree, active?.id ?? null, orientation)
  const gameReview = useGameReview(tree)
  const aiTurn = [...conversation.turns].reverse().find((turn) => turn.question === null)

  // Auto-explain only after the user dwells on an analysed position; quick browsing never asks.
  const ask = useRef(conversation.ask)
  useEffect(() => {
    ask.current = conversation.ask
  }, [conversation.ask])
  const analysed = engine.status === 'done' && engine.analysis !== null && engine.analysis.position_id === position?.position_id
  const hasExplanation = aiTurn !== undefined
  useEffect(() => {
    if (!autoExplain || !analysed || hasExplanation) return
    const timer = setTimeout(() => void ask.current(null), AUTO_EXPLAIN_DWELL_MS)
    return () => clearTimeout(timer)
  }, [autoExplain, analysed, hasExplanation, conversation.key])
  const lines = engine.analysis?.lines ?? []
  const gameChild = active?.children.find((c) => tree?.nodes[c].variationId === MAIN)
  const shapes = useMemo(
    () => (position ? engineShapes(engine.analysis, position.side_to_move) : []),
    [engine.analysis, position],
  )

  const playHere = useCallback(
    async (move: string) => (position ? (await play(position, move)) !== null : false),
    [play, position],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Crazyhouse Review</h1>
        {tree?.headers.White && (
          <span className="players">
            {tree.headers.White} – {tree.headers.Black} {tree.headers.Result}
          </span>
        )}
        <PgnLoader onLoad={review.loadText} onNewGame={() => void review.newGame()} />
      </header>

      {review.error && (
        <div className="error" role="alert">
          {review.error}
          <button onClick={review.clearError}>×</button>
        </div>
      )}
      {review.variantAssumed && <div className="notice">PGN 未標示 Variant，已以 Crazyhouse 規則載入。</div>}

      {tree && active && position && (
        <main className="layout">
          <section className="board-column">
            <ReviewBoard position={position} orientation={orientation} onPlay={playHere} shapes={shapes} />
            <NavControls onNavigate={review.navigate} onFlip={flip} />
          </section>

          <aside className="side-column">
            <EnginePanel
              position={position}
              engine={engine}
              enabled={engineOn}
              onToggle={toggleEngine}
              onPlayLine={(moves) => void playLine(position, moves.map((m) => m.uci))}
            />
            <WhyPanel
              position={position}
              view={insights}
              engineOn={engineOn}
              aiTurn={aiTurn}
              onExplain={() => void conversation.ask(null)}
              autoExplain={autoExplain}
              onToggleAutoExplain={toggleAutoExplain}
            />
            <section className="panel status" data-testid="status">
              <div>
                <strong>{position.side_to_move === 'white' ? '白方' : '黑方'}</strong> 走棋 · 第 {position.move_number} 回合 · ply {position.ply}
                {active.variationId !== MAIN && <span className="badge">變化</span>}
              </div>
              {active.variationId !== MAIN && (
                <button className="back-to-main" onClick={() => review.select(mainlineAncestor(tree, active.id))}>
                  回到主線
                </button>
              )}
              {position.outcome && (
                <div className="outcome">
                  {position.outcome.result} ({position.outcome.termination})
                </div>
              )}
              <code className="fen" title="Crazyhouse FEN">{position.fen}</code>
            </section>
            <section className="panel moves">
              <MoveList
                tree={tree}
                activeId={active.id}
                onSelect={review.select}
                onDelete={review.deleteVariation}
                review={gameReview.byPosition}
              />
            </section>
            <ReviewPanel tree={tree} review={gameReview} activeId={active.id} onSelect={review.select} />
            <MoveInput onPlay={playHere} disabled={position.outcome !== null} />
            <ChatPanel
              turns={conversation.turns}
              onAsk={(question) => void conversation.ask(question)}
              bestSan={lines[0]?.pv[0].san ?? null}
              secondSan={lines[1]?.pv[0].san ?? null}
              gameMoveSan={gameChild ? (tree.nodes[gameChild].state.last_move?.san ?? null) : null}
            />
          </aside>
        </main>
      )}
    </div>
  )
}

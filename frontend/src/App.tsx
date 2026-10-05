import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import './App.css'
import { useCallback, useMemo, useState } from 'react'
import { EnginePanel } from './components/EnginePanel'
import { MoveInput } from './components/MoveInput'
import { MoveList } from './components/MoveList'
import { NavControls } from './components/NavControls'
import { PgnLoader } from './components/PgnLoader'
import { ReviewBoard } from './components/ReviewBoard'
import { WhyPanel } from './components/WhyPanel'
import { engineShapes } from './engineShapes'
import { MAIN, mainlineAncestor } from './tree'
import type { Color } from './types'
import { useEngine } from './useEngine'
import { useInsights } from './useInsights'
import { useReview } from './useReview'

export default function App() {
  const review = useReview()
  const [orientation, setOrientation] = useState<Color>('white')
  const flip = useCallback(() => setOrientation((o) => (o === 'white' ? 'black' : 'white')), [])
  const { tree, active, play, playLine } = review
  const position = active?.state
  const engine = useEngine(position ?? null)
  const insights = useInsights(position ?? null, engine)
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
        <PgnLoader onLoad={review.loadPgn} onNewGame={() => void review.newGame()} />
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
              onPlayLine={(moves) => void playLine(position, moves.map((m) => m.uci))}
            />
            <WhyPanel position={position} view={insights} />
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
              <MoveList tree={tree} activeId={active.id} onSelect={review.select} onDelete={review.deleteVariation} />
            </section>
            <MoveInput onPlay={playHere} disabled={position.outcome !== null} />
          </aside>
        </main>
      )}
    </div>
  )
}

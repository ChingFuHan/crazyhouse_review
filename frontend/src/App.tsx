import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import './App.css'
import { useCallback, useState } from 'react'
import { Board } from './components/Board'
import { MoveList } from './components/MoveList'
import { NavControls } from './components/NavControls'
import { PgnLoader } from './components/PgnLoader'
import { Pocket } from './components/Pocket'
import { MAIN } from './tree'
import type { Color } from './types'
import { useReview } from './useReview'

export default function App() {
  const review = useReview()
  const [orientation, setOrientation] = useState<Color>('white')
  const flip = useCallback(() => setOrientation((o) => (o === 'white' ? 'black' : 'white')), [])
  const { tree, active } = review

  const opponent: Color = orientation === 'white' ? 'black' : 'white'
  const position = active?.state

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
            <Pocket color={opponent} pieces={position.pockets[opponent]} active={false} />
            <div className="board-wrap">
              <Board position={position} orientation={orientation} />
            </div>
            <Pocket color={orientation} pieces={position.pockets[orientation]} active={false} />
            <NavControls onNavigate={review.navigate} onFlip={flip} />
          </section>

          <aside className="side-column">
            <section className="panel status" data-testid="status">
              <div>
                <strong>{position.side_to_move === 'white' ? '白方' : '黑方'}</strong> 走棋 · 第 {position.move_number} 回合 · ply {position.ply}
                {active.variationId !== MAIN && <span className="badge">變化</span>}
              </div>
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
          </aside>
        </main>
      )}
    </div>
  )
}

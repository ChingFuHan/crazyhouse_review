import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import './App.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { EnginePanel } from './components/EnginePanel'
import { ExportPanel } from './components/ExportPanel'
import { GameInfo } from './components/GameInfo'
import { LearnPanel } from './components/LearnPanel'
import { MoveInput } from './components/MoveInput'
import { Nav } from './components/Nav'
import { MoveList } from './components/MoveList'
import { NavControls } from './components/NavControls'
import { PgnLoader } from './components/PgnLoader'
import { PuzzleTools } from './components/PuzzleTools'
import { ReviewBoard } from './components/ReviewBoard'
import { ReviewPanel } from './components/ReviewPanel'
import { WhyPanel } from './components/WhyPanel'
import { describeChoice, useAiChoice } from './aiChoice'
import { useEngineSettings } from './engineSettings'
import { engineShapes } from './engineShapes'
import { known } from './gameInfo'
import { MAIN, mainlineAncestor } from './tree'
import type { Key } from 'chessground/types'
import type { Color } from './types'
import { useBooleanPreference } from './preferences'
import { useConversation } from './useConversation'
import { useEngine } from './useEngine'
import { useGameReview } from './useGameReview'
import { useGameScan } from './useGameScan'
import { useInsights } from './useInsights'
import { useLearn } from './useLearn'
import { useReview } from './useReview'

/** Auto-explain waits until the user has stayed on a position this long after its analysis is done. */
const AUTO_EXPLAIN_DWELL_MS = 1500
/** A long or infinite search is deep enough to explain once a milestone reaches this depth. */
const AUTO_EXPLAIN_MIN_DEPTH = 15

type SideTab = 'why' | 'ask' | 'game'
const SIDE_TABS: [SideTab, string][] = [
  ['why', '為什麼'],
  ['ask', '問 AI'],
  ['game', '對局與工具'],
]
const TAB_KEY = 'crazyhouse-review:side-tab'

function loadTab(): SideTab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    return SIDE_TABS.some(([tab]) => tab === saved) ? (saved as SideTab) : 'why'
  } catch {
    return 'why'
  }
}

export default function App() {
  const review = useReview()
  const [orientation, setOrientation] = useState<Color>('white')
  const flip = useCallback(() => setOrientation((o) => (o === 'white' ? 'black' : 'white')), [])
  const { tree, active, play, playLine } = review
  const position = active?.state
  const [engineOn, toggleEngine] = useBooleanPreference('engine-on', true)
  const [autoExplain, toggleAutoExplain] = useBooleanPreference('auto-explain', false)
  const [settings, changeSettings] = useEngineSettings()
  const engine = useEngine(position ?? null, engineOn, settings)
  const insights = useInsights(position ?? null, engine)
  const conversation = useConversation(tree, active?.id ?? null, orientation)
  const [autoReview, toggleAutoReview] = useBooleanPreference('auto-review', true)
  const gameReview = useGameReview(tree, autoReview)
  const learn = useLearn(tree, gameReview.job, review.select)
  const [tab, setTab] = useState<SideTab>(loadTab)
  const chooseTab = (next: SideTab) => {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // best-effort
    }
  }
  const gameScan = useGameScan(tree)
  const ai = useAiChoice()
  // A scan needs the whole-game review: start the review panel too (the backend runs one shared job).
  const startReview = gameReview.start
  const reviewShown = gameReview.job !== null
  const startScan = gameScan.start
  const aiLabel = describeChoice(ai.choice, ai.catalog)
  const scan = useCallback(
    (side: Color) => {
      if (!reviewShown) startReview()
      startScan(side, ai.choice, aiLabel)
    },
    [reviewShown, startReview, startScan, ai.choice, aiLabel],
  )
  const aiTurn = [...conversation.turns].reverse().find((turn) => turn.question === null)

  // Questions explain exactly the engine result on screen.
  const shownId = engine.analysis?.lines.length ? engine.analysis.analysis_id : null
  const askQuestion = conversation.ask
  const aiChoice = ai.choice
  const askAbout = useCallback(
    (question: string | null) => askQuestion(question, shownId, aiChoice, aiLabel),
    [askQuestion, shownId, aiChoice, aiLabel],
  )

  // Auto-explain only after the user dwells on an analysed position; quick browsing never asks.
  const ask = useRef(askAbout)
  useEffect(() => {
    ask.current = askAbout
  }, [askAbout])
  const analysed =
    engine.analysis?.position_id === position?.position_id &&
    (engine.status === 'done' || (engine.milestone?.depth ?? 0) >= AUTO_EXPLAIN_MIN_DEPTH)
  const hasExplanation = aiTurn !== undefined
  useEffect(() => {
    if (!autoExplain || !analysed || hasExplanation) return
    const timer = setTimeout(() => void ask.current(null), AUTO_EXPLAIN_DWELL_MS)
    return () => clearTimeout(timer)
  }, [autoExplain, analysed, hasExplanation, conversation.key])
  const lines = engine.analysis?.lines ?? []
  const gameChild = active?.children.find((c) => tree?.nodes[c].variationId === MAIN)
  // On a learning exercise the engine's arrows would give the answer away: only the move found (or
  // the answer) is drawn there.
  const exercise = active ? learn.onExercise(active.id) : false
  const learnArrow = learn.arrow
  const shapes = useMemo(() => {
    if (!position) return []
    if (!exercise) return engineShapes(engine.analysis, position.side_to_move)
    if (!learnArrow) return []
    return learnArrow.drop
      ? [{ orig: learnArrow.to as Key, brush: 'green' }]
      : [{ orig: learnArrow.from as Key, dest: learnArrow.to as Key, brush: 'green' }]
  }, [engine.analysis, position, exercise, learnArrow])

  const attempt = learn.attempt
  const playHere = useCallback(
    async (move: string) => {
      if (!position) return false
      if (exercise) return attempt(position, move) // a try: judged, never added to the game
      return (await play(position, move)) !== null
    },
    [play, position, exercise, attempt],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Crazyhouse Review</h1>
        <Nav current="review" />
        {tree && (known(tree.headers.White) || known(tree.headers.Black)) && (
          <span className="players">
            {known(tree.headers.White) ?? '?'} – {known(tree.headers.Black) ?? '?'} {tree.headers.Result}
          </span>
        )}
        <PgnLoader onLoad={review.loadText} onNewGame={() => void review.newGame()} onOpenRecent={review.openRecent} />
      </header>

      {review.error && (
        <div className="error" role="alert">
          {review.error}
          <button onClick={review.clearError}>×</button>
        </div>
      )}
      {review.variantAssumed && <div className="notice">PGN 未標示 Variant，已以 Crazyhouse 規則載入。</div>}

      {tree && active && position && (
        <main className="review-layout">
          <section className="board-column">
            <ReviewBoard position={position} orientation={orientation} onPlay={playHere} shapes={shapes} />
            <NavControls onNavigate={review.navigate} onFlip={flip} />
            <section className="panel status" data-testid="status">
              <div>
                <strong>{position.side_to_move === 'white' ? '白方' : '黑方'}</strong> 走棋 · 第 {position.move_number} 回合 · ply {position.ply}
                {active.variationId !== MAIN && <span className="badge">變化</span>}
                {exercise && <span className="badge">練習中</span>}
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
            <MoveInput onPlay={playHere} disabled={position.outcome !== null} />
          </section>

          <aside className="side-column">
            {!exercise && (
              <EnginePanel
                position={position}
                engine={engine}
                enabled={engineOn}
                onToggle={toggleEngine}
                settings={settings}
                onSettingsChange={changeSettings}
                onPlayLine={(moves) => void playLine(position, moves.map((m) => m.uci))}
              />
            )}
            <section className="panel moves">
              <MoveList
                tree={tree}
                activeId={active.id}
                onSelect={review.select}
                onDelete={review.deleteVariation}
                onPromote={review.promoteToMain}
                review={gameReview.byPosition}
              />
            </section>
            <nav className="side-tabs" aria-label="側欄">
              {SIDE_TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? 'active' : ''}
                  aria-pressed={tab === key}
                  onClick={() => chooseTab(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {exercise && (
              <section className="panel engine-note" data-testid="learn-hidden">
                練習中：engine 的線、箭頭與說明先隱藏，以免洩題；按「下一題」或離開這個局面就會恢復。
              </section>
            )}
            <div className="side-tab" hidden={tab !== 'why' || exercise}>
              <WhyPanel
                position={position}
                view={insights}
                engineOn={engineOn}
                aiTurn={aiTurn}
                onExplain={() => void askAbout(null)}
                autoExplain={autoExplain}
                onToggleAutoExplain={toggleAutoExplain}
                aiLabel={aiLabel}
                onCancel={conversation.cancel}
              />
            </div>
            <div className="side-tab" hidden={tab !== 'ask'}>
              <ChatPanel
                turns={conversation.turns}
                onAsk={(question) => void askAbout(question)}
                bestSan={lines[0]?.pv[0].san ?? null}
                secondSan={lines[1]?.pv[0].san ?? null}
                gameMoveSan={gameChild ? (tree.nodes[gameChild].state.last_move?.san ?? null) : null}
                scans={gameScan.scans}
                onScan={scan}
                onCancelScan={gameScan.cancel}
                onCancel={conversation.cancel}
                ai={ai}
              />
            </div>
            <div className="side-tab" hidden={tab !== 'game'}>
              <GameInfo headers={tree.headers} />
              <section className="panel tools">
                <ExportPanel tree={tree} />
                <PuzzleTools tree={tree} position={position} />
              </section>
            </div>
          </aside>

          <section className="under-board">
            <ReviewPanel
              tree={tree}
              review={gameReview}
              activeId={active.id}
              onSelect={review.select}
              auto={autoReview}
              onToggleAuto={toggleAutoReview}
              practising={exercise}
            />
            <LearnPanel tree={tree} job={gameReview.job} learn={learn} activeId={active.id} onSelect={review.select} />
          </section>
        </main>
      )}
    </div>
  )
}

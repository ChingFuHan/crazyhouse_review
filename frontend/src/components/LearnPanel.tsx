import { known } from '../gameInfo'
import { LABEL } from '../reviewText'
import type { GameTree } from '../tree'
import type { Color, ReviewJob } from '../types'
import { type Learn, learnItems } from '../useLearn'

export interface LearnPanelProps {
  tree: GameTree
  job: ReviewJob | null
  learn: Learn
  activeId: string
  onSelect: (id: string) => void
}

const SIDE: Record<Color, string> = { white: '白方', black: '黑方' }

/** Practise one side's mistakes from the whole-game review. */
export function LearnPanel({ tree, job, learn, activeId, onSelect }: LearnPanelProps) {
  const ready = job?.status === 'done'
  const item = learn.items[learn.index]
  return (
    <section className="panel learn" data-testid="learn">
      <header className="engine-header">
        <h2>從錯誤中學習</h2>
        {learn.side && <button onClick={learn.stop}>結束練習</button>}
      </header>
      {!learn.side &&
        (ready ? (
          <div className="learn-start">
            {(['white', 'black'] as Color[]).map((side) => {
              const count = learnItems(tree, job!, side).length
              const name = known(side === 'white' ? tree.headers.White : tree.headers.Black)
              return (
                <button key={side} disabled={count === 0} onClick={() => learn.start(side)}>
                  練習{SIDE[side]}{name ? `（${name}）` : ''}的失誤：{count} 題
                </button>
              )
            })}
            <p className="muted">回到每個錯著、大錯或殺棋失誤之前的局面，找出更好的著法；engine 判定，不會加進棋譜。</p>
          </div>
        ) : (
          <p className="muted">整局分析完成後就能練習。</p>
        ))}
      {learn.side && learn.done && (
        <div className="engine-note" data-testid="learn-done">
          練習完成：{learn.items.length} 題中找到 {learn.solved} 題。
          <button onClick={() => learn.start(learn.side!)}>再練一次</button>
        </div>
      )}
      {learn.side && item && (
        <div className="learn-item" data-testid="learn-item">
          <div>
            第 {learn.index + 1}/{learn.items.length} 題：實戰 <strong>{item.played}</strong> 是{LABEL[item.classification]}，
            找出更好的著法。
          </div>
          {!learn.onExercise(activeId) && (
            <div className="muted">
              棋盤不在這一題的局面。<button onClick={() => onSelect(item.beforeId)}>回到這一題</button>
            </div>
          )}
          {learn.message && (
            <div className={`learn-feedback ${learn.status}`} data-testid="learn-feedback">
              {learn.message}
            </div>
          )}
          <div className="puzzle-actions">
            {learn.status !== 'good' && learn.status !== 'answer' && item.bestSan && (
              <button onClick={() => void learn.showAnswer()}>看答案</button>
            )}
            <button className={learn.status === 'good' || learn.status === 'answer' ? 'primary' : undefined} onClick={learn.next}>
              {learn.index + 1 < learn.items.length ? '下一題' : '完成'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

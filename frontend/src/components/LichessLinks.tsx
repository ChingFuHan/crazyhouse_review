import { useState } from 'react'
import { api } from '../api'
import { exportNodes } from '../exportPgn'
import { importToLichess, lichessAnalysisUrl } from '../lichess'
import type { GameTree } from '../tree'
import type { Color, PositionState } from '../types'

export interface LichessLinksProps {
  tree: GameTree
  position: PositionState
  orientation: Color
}

/** Continue on lichess: the analysis board on this position (nothing is sent), or the whole game
 * imported there (a public imported game; lichess keeps the main line only). */
export function LichessLinks({ tree, position, orientation }: LichessLinksProps) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = async () => {
    setConfirming(false)
    setBusy(true)
    setError(null)
    // Opened during the click, so no popup blocker stops it; pointed at the game once it exists.
    const tab = window.open('about:blank', '_blank')
    try {
      const root = tree.nodes[tree.rootId].state
      const { pgn } = await api.exportPgn(root.root_fen, tree.headers, exportNodes(tree))
      const url = await importToLichess(pgn)
      setImported(url)
      if (tab) {
        tab.opener = null
        tab.location.href = url
      }
    } catch (e) {
      tab?.close()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lichess-links" data-testid="lichess-links">
      <a className="button" href={lichessAnalysisUrl(position.fen, orientation)} target="_blank" rel="noopener noreferrer">
        在 lichess 分析這個局面
      </a>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} disabled={busy}>
          {busy ? '上傳中…' : '上傳整盤到 lichess…'}
        </button>
      ) : (
        <div className="lichess-confirm" role="group" aria-label="上傳到 lichess">
          <span>會在 lichess 建立一盤公開的匯入對局；lichess 只保留主線，變化與註解會被移除。</span>
          <button className="primary" onClick={() => void upload()}>
            確定上傳
          </button>
          <button onClick={() => setConfirming(false)}>取消</button>
        </div>
      )}
      {imported && (
        <a href={imported} target="_blank" rel="noopener noreferrer" data-testid="lichess-imported">
          已上傳：在 lichess 開啟
        </a>
      )}
      {error && <div className="engine-error">上傳失敗：{error}</div>}
    </div>
  )
}

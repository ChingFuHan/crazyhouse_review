import { useState } from 'react'
import { api } from '../api'
import { copyText } from '../clipboard'
import { exportNodes } from '../exportPgn'
import type { GameTree } from '../tree'

/** Export the analysis (game + variations + comments) as a crazyhouse PGN: copy or download. */
export function ExportPanel({ tree }: { tree: GameTree }) {
  const [pgn, setPgn] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const open = async () => {
    setMessage(null)
    try {
      const root = tree.nodes[tree.rootId].state
      setPgn((await api.exportPgn(root.root_fen, tree.headers, exportNodes(tree))).pgn)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const copy = async () => {
    setMessage((await copyText(pgn!)) ? '已複製' : '無法存取剪貼簿，請手動選取複製')
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([pgn!], { type: 'application/x-chess-pgn' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'crazyhouse-review.pgn'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="export" data-testid="export">
      {pgn === null ? (
        <button onClick={() => void open()}>匯出 PGN</button>
      ) : (
        <>
          <textarea aria-label="匯出的 PGN" readOnly value={pgn} rows={6} />
          <div className="row">
            <button onClick={() => void copy()}>複製</button>
            <button onClick={download}>下載 .pgn</button>
            <button onClick={() => setPgn(null)}>關閉</button>
          </div>
        </>
      )}
      {message && <div className="engine-note">{message}</div>}
    </div>
  )
}

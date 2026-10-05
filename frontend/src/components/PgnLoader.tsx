import { useState } from 'react'

export interface PgnLoaderProps {
  onLoad: (pgn: string) => Promise<boolean>
  onNewGame: () => void
}

export function PgnLoader({ onLoad, onNewGame }: PgnLoaderProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <div className="pgn-loader">
        <button onClick={() => setOpen(true)}>載入 PGN</button>
        <button onClick={onNewGame}>新局面</button>
      </div>
    )
  }
  return (
    <div className="pgn-loader open">
      <textarea
        aria-label="PGN"
        placeholder="貼上 Crazyhouse PGN"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        autoFocus
      />
      <div className="row">
        <button
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true)
            const ok = await onLoad(text)
            setBusy(false)
            if (ok) setOpen(false)
          }}
        >
          載入
        </button>
        <button onClick={() => setOpen(false)}>取消</button>
      </div>
    </div>
  )
}

import { useState } from 'react'

/** Type a move (SAN like Nf3 / N@e7+, or UCI like g1f3 / N@e7). The backend parses and validates it. */
export function MoveInput({ onPlay, disabled }: { onPlay: (move: string) => Promise<boolean>; disabled: boolean }) {
  const [text, setText] = useState('')
  return (
    <form
      className="move-input"
      onSubmit={async (e) => {
        e.preventDefault()
        if (text.trim() && (await onPlay(text.trim()))) setText('')
      }}
    >
      <input
        aria-label="輸入棋步"
        placeholder="輸入棋步 (Nf3, N@e7, e2e4)"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        走
      </button>
    </form>
  )
}

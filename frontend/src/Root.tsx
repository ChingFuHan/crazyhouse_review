import App from './App'
import { PuzzlePage } from './puzzles/PuzzlePage'
import { usePage } from './route'

/** The review board and the puzzle page; only the page on screen is mounted (and uses the engine). */
export function Root() {
  return usePage() === 'puzzles' ? <PuzzlePage /> : <App />
}

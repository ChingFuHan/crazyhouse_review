# Crazyhouse Review

Interactive review board for Crazyhouse games: load a PGN, step through moves, play your own
variations, and (planned) get Fairy-Stockfish analysis plus LLM explanations grounded in
engine output and deterministic position facts.

## Architecture
- `backend/` — FastAPI + python-chess. `app/chess_core.py` is the single Crazyhouse rules
  implementation; every position is a line (`root_fen` + UCI moves) identified by `position_id`.
- `frontend/` — React + TypeScript + Vite + Chessground. Renders backend positions only; it has
  no chess rules of its own.

## Setup
Requirements: Python ≥ 3.13 with [uv](https://docs.astral.sh/uv/), Node ≥ 22.

```bash
cd backend && uv sync
cd ../frontend && npm install
```

## Run
```bash
# terminal 1
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820
# terminal 2
cd frontend && npx vite --host 127.0.0.1 --port 5180
```
Open http://127.0.0.1:5180.

## Tests
```bash
cd backend && uv run pytest -q
cd frontend && npx vitest run && npx tsc -b && npx playwright test
```

## Current features
- Crazyhouse position state (FEN with pockets and promoted markers), legal moves incl. drops
- Move input as UCI or SAN with readable illegal-move reasons
- Crazyhouse PGN import (variations and comments kept as data)
- Review board: PGN load, pockets, move list with variations, keyboard navigation, flip
- Play your own moves: drag pieces, drag from the pocket (legal squares highlighted),
  promotion chooser, typed moves (SAN/UCI); your moves form variations, the PGN main line
  is never changed; 「回到主線」 returns to where you branched off

## Known limitations
- No engine or LLM integration yet.

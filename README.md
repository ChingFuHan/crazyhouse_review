# Crazyhouse Review

Interactive review board for Crazyhouse games: load a PGN, step through moves, play your own
variations, and (planned) get Fairy-Stockfish analysis plus LLM explanations grounded in
engine output and deterministic position facts.

## Architecture
- `backend/` — FastAPI + python-chess. `app/chess_core.py` is the single Crazyhouse rules
  implementation; every position is a line (`root_fen` + UCI moves) identified by `position_id`.

## Setup
```bash
cd backend
uv sync
uv run pytest -q
uv run uvicorn app.main:app --port 8820
```

## Current features
- Crazyhouse position state (FEN with pockets and promoted markers), legal moves incl. drops
- Move input as UCI or SAN with readable illegal-move reasons
- Crazyhouse PGN import (variations and comments kept as data)

## Known limitations
- No UI, engine or LLM integration yet.

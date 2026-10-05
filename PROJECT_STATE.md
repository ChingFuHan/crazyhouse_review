# PROJECT_STATE

Persistent handoff between agent loops. Read before PLAN, update after FINAL.
Task spec: `task.md`.

## Current milestone
Milestone 1 (PGN → board → navigation → pockets → rules → variations).

## Current architecture
- `backend/` Python 3.13 (uv), FastAPI, python-chess 1.11.2.
  - `app/chess_core.py`: the ONLY rules implementation (python-chess `CrazyhouseBoard`).
    Canonical `PositionState` built from a line = `root_fen` + UCI `moves`.
    `position_id = sha256(root_fen|moves)[:16]` → any layer can recompute/verify it.
  - `app/pgn_import.py`: PGN → tree of `PositionState` (comments kept as data; missing
    Variant tag ⇒ crazyhouse assumed + `variant_assumed=true`; other variants rejected).
  - `app/routers/game.py`: `POST /api/position`, `/api/move`, `/api/pgn`; `GET /api/health`.
    `position_id` sent by a client is verified (409 on mismatch).
  - `app/models.py`: pydantic schemas. Move = {uci, san, from, to, drop, promotion, is_capture}.
- Frontend: not started. Plan: React + TS + Vite + Chessground; NO rules logic in frontend —
  legal moves/dests come from backend `PositionState.legal_moves`.

## Completed features
- Crazyhouse canonical state, move parsing (UCI or SAN) with human-readable illegal reasons.
- PGN import with variations/comments.

## Important decisions
- Backend is rules authority; frontend tree stores only backend-produced states.
- position_id is per line (transpositions get different ids; history matters).
- Pawn drop SAN displayed lichess-style `P@e4` (python-chess emits `@e4`).
- Port 8765 is taken on this host by another service; use 8820 for backend dev.

## Known bugs
- none known

## Known limitations
- No engine, no frontend, no LLM yet.

## Verification status
- `cd backend && uv run pytest -q` → 55 passed.
- Real-data cross-check: 3 finished lichess crazyhouse games (fixtures) reach lichess's own
  final FEN (board, pocket, side, castling). Ongoing TV games mismatch only because lichess
  delays published moves of games in progress (not a rules issue).

## Last successful commands
- `cd backend && uv run pytest -q`
- `cd backend && uv run uvicorn app.main:app --port 8820`

## Next recommended task
Frontend shell: Vite + React + TS + Chessground board rendering backend PositionState,
pockets, PGN load, move navigation.

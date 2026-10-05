# PROJECT_STATE

Persistent handoff between agent loops. Read before PLAN, update after FINAL.
Task spec: `task.md`.

## Current milestone
Milestone 1 (PGN → board → navigation → pockets → rules → variations). Remaining: user moves/drops/variations.

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
- `frontend/` React 19 + TS + Vite 8 + Chessground 9.2. NO rules logic in the browser.
  - `src/tree.ts`: pure game tree of backend states (id = position_id). Invariant check on every
    insert (child line = parent line + 1 move). `variationId` = "main" or `v:<first node id>`;
    `origin` pgn|user; user moves never join the main line (even after the last PGN move).
  - `src/useReview.ts`: reducer (tree, activeId); load generation guard against stale loads;
    a played move only becomes active if the user is still on its parent.
  - `src/components/`: Board (chessground wrapper, `data-fen`/`data-position-id` attrs),
    Pocket (reuses chessground piece sprites), MoveList (lichess-style inline variations),
    NavControls (buttons + ←/→/Home/End/↑/↓, f = flip), PgnLoader.
  - Vite dev server :5180 proxies `/api` → backend :8820.

## Completed features
- Crazyhouse canonical state, move parsing (UCI or SAN) with human-readable illegal reasons.
- PGN import with variations/comments.
- UI: PGN load, board + pockets, move list with variations/comments, navigation, flip.

## Important decisions
- Backend is rules authority; frontend tree stores only backend-produced states.
- position_id is per line (transpositions get different ids; history matters).
- Pawn drop SAN displayed lichess-style `P@e4` (python-chess emits `@e4`).
- Port 8765 is taken on this host by another service; use 8820 for backend dev.

## Known bugs
- none known

## Known limitations
- Board is view-only: user moves, pocket drag/drop, promotion dialog not implemented yet.
- No engine, no LLM yet.

## Verification status
- `cd backend && uv run pytest -q` → 55 passed.
- `cd frontend && npx vitest run` → 9 passed; `npx tsc -b`, `npm run lint`, `npx vite build` clean.
- `cd frontend && npx playwright test` → 3 passed (real backend + vite; DOM board/pockets compared
  square-by-square to backend FEN, incl. all 83 plies of a real lichess game).
- Real-data cross-check: 3 finished lichess crazyhouse games (fixtures) reach lichess's own
  final FEN (board, pocket, side, castling). Ongoing TV games mismatch only because lichess
  delays published moves of games in progress (not a rules issue).

## Last successful commands
- `cd backend && uv run pytest -q`
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820`
- `cd frontend && npx vite --host 127.0.0.1 --port 5180`
- `cd frontend && npx playwright test` (starts/reuses both servers)

## Next recommended task
Interactive moves: board drag (backend legal dests), promotion chooser, pocket drag/drop with
legal-square highlight + illegal drop rollback, user variations (create/select/delete),
return to main line. Completes Milestone 1.

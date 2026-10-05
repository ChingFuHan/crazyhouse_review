# PROJECT_STATE

Persistent handoff between agent loops. Read before PLAN, update after FINAL.
Task spec: `task.md`.

## Current milestone
Milestone 1 DONE (PGN → board → navigation → pockets → rules → variations).
Milestone 2 DONE (Fairy-Stockfish → White-POV eval → best move → MultiPV 3 → PV, arrows).
Next: Milestone 3 (Position Analyzer → structured facts → LLM → "Why this move?").

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
  - `app/engine.py` EngineService: one Fairy-Stockfish 14 process (python-chess async UCI; python-chess
    sets `UCI_Variant crazyhouse` from CrazyhouseBoard). A newer request stops the running search
    (generation counter; superseded → status "cancelled", never cached). LRU cache keyed by
    (position_id, multipv, movetime). Timeout/crash → process restart. `analysis_id` = hash of
    the result content (for LLM cache keys). Scores normalized to White POV (`evaluation` pawns,
    `mate` +White/−Black, `evaluation_pov: "white"`).
  - `app/routers/engine.py`: `POST /api/analyze` (409 position_id mismatch, `game_over` status,
    503 `engine_unavailable`). `app/config.py`: ENGINE_PATH/THREADS(4)/HASH_MB(256)/MOVETIME_MS(1500).
  - `scripts/fetch_engine.sh` → `engines/fairy-stockfish` (gitignored; fairy_sf_14 release, bmi2
    build here, sha256 9c8ff22d…). Classical eval (no crazyhouse NNUE file installed).
- `frontend/` React 19 + TS + Vite 8 + Chessground 9.2. NO rules logic in the browser.
  - `src/tree.ts`: pure game tree of backend states (id = position_id). Invariant check on every
    insert (child line = parent line + 1 move). `variationId` = "main" or `v:<first node id>`;
    `origin` pgn|user; user moves never join the main line (even after the last PGN move).
  - `src/useReview.ts`: reducer (tree, activeId); load generation guard against stale loads;
    a played move only becomes active if the user is still on its parent.
  - `src/components/`: Board (chessground wrapper, `data-fen`/`data-position-id` attrs),
    Pocket (reuses chessground piece sprites), MoveList (lichess-style inline variations),
    NavControls (buttons + ←/→/Home/End/↑/↓, f = flip), PgnLoader, MoveInput (SAN/UCI text),
    ReviewBoard (board + pockets + promotion chooser; every move is sent to the backend; a
    rejected move bumps `syncKey` so chessground re-syncs to the canonical FEN).
  - `src/moves.ts`: legal UCI list → chessground dests / drop squares / promotion choices.
  - Chessground caches board bounds; ReviewBoard clears them on every pointer-down (layout
    shifts above the board otherwise map drops to the wrong square — real bug found by E2E).
  - MoveList: a node's continuation is the child with the SAME variationId; other children are
    rendered as (variations).
  - `src/useEngine.ts`: debounce 120 ms, quick 300 ms then 1500 ms search; AbortController on
    position change; a result is exposed only if its position_id == active position_id.
  - EnginePanel (eval White POV + bar, best move, MultiPV lines; clicking a PV move plays the line
    via `playLine`), `engineShapes.ts` (arrows; drops = ghost piece + circle on the target).
  - Vite dev server :5180 proxies `/api` → backend :8820.

## Completed features
- Crazyhouse canonical state, move parsing (UCI or SAN) with human-readable illegal reasons.
- PGN import with variations/comments.
- UI: PGN load, board + pockets, move list with variations/comments, navigation, flip.
- Interaction: drag moves, pocket drag/drop with legal-square highlight, promotion chooser
  (cancel restores), typed moves, user variations (delete ×), 「回到主線」.
- Engine: Fairy-Stockfish analysis of the active position, MultiPV 3, mate scores, arrows/drop
  markers, click-to-play PV.
- Fresh game (no PGN): the first user line is the main line. PGN game: user moves are always
  variations; the PGN main line is never modified.

## Important decisions
- Backend is rules authority; frontend tree stores only backend-produced states.
- position_id is per line (transpositions get different ids; history matters).
- Pawn drop SAN displayed lichess-style `P@e4` (python-chess emits `@e4`).
- Port 8765 is taken on this host by another service; use 8820 for backend dev.
- Playwright uses its own ports (8821/5181) and never reuses servers (stale dev servers once
  produced false results).

## Known bugs
- none known

## Known limitations
- No click-to-drop (pocket piece then square) yet; drag only. No touch E2E coverage.
- Engine: single shared process; two browser tabs analysing at once cancel each other's searches.
  No streaming (two fixed-length phases). Classical eval only (NNUE net not installed).
- No Position Analyzer, no LLM yet.

## Verification status
- `cd backend && uv run pytest -q` → 71 passed (incl. real Fairy-Stockfish: drop mates both colors,
  supersede race (deterministic; proven to fail without the fix), crash restart, and FSF `d`/`perft 1`
  vs python-chess FEN + legal-move set for all 174 plies of the 3 real games — identical).
- `cd frontend && npx vitest run` → 16 passed; `npx tsc -b`, `npm run lint`, `npx vite build` clean.
- `cd frontend && npx playwright test` → 9 passed (engine: drop mate #1/#-1, drop marker, PV click,
  engine panel position_id always == board position_id during fast navigation) (real backend :8821 + vite :5181, fresh servers;
  DOM board/pockets compared square-by-square to backend FEN; real mouse drags incl. pocket
  drops, flipped board, illegal pawn drop rollback, promotion → captured → pawn in pocket).
- Real-data cross-check: 3 finished lichess crazyhouse games (fixtures) reach lichess's own
  final FEN (board, pocket, side, castling). Ongoing TV games mismatch only because lichess
  delays published moves of games in progress (not a rules issue).

## Last successful commands
- `cd backend && uv run pytest -q`
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820`
- `cd frontend && npx vite --host 127.0.0.1 --port 5180`
- `cd frontend && npx playwright test` (starts its own servers on 8821/5181)

## Next recommended task
Milestone 3a: deterministic Position Analyzer (`app/analyzer.py`): per position facts (check,
king escape squares, attacked/defended pieces, possible drop checks, defensive drops) and per
candidate move facts (is_check/capture/drop/promotion/mate, escape squares before/after, attacks
on Q/R, pocket before/after, forced reply) computed from python-chess + engine PV. Endpoint
returning structured facts for the active position + engine lines. Then 3b: LLM provider.

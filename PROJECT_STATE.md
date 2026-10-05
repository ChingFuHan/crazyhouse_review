# PROJECT_STATE

Persistent handoff between agent loops. Read before PLAN, update after FINAL.
Task spec: `task.md`.

## Current milestone
Milestone 1 DONE (PGN → board → navigation → pockets → rules → variations).
Milestone 2 DONE (Fairy-Stockfish → White-POV eval → best move → MultiPV 3 → PV, arrows).
Milestone 3: Analyzer + deterministic "Why this move?" DONE; LLM layer DONE but real Claude calls
UNVERIFIED (no ANTHROPIC_API_KEY available) → PARTIAL.
Milestone 4 (chat + candidate re-analysis + variation-aware Q&A) DONE with the fake LLM; the task.md
§55 core flow passes end-to-end (e2e/core-flow.spec.ts). Real-LLM answer quality still unverified.
Whole-game review (critical moves, task.md §30) + eval graph DONE.

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
  - Identical concurrent engine requests share one search (`_inflight`, shielded); only a
    different request supersedes. `/api/insights` reuses the cached default-settings result, so its
    `analysis_id` equals the one the UI displays.
  - `app/analyzer.py`: deterministic facts. Position: check/checkers, per side king escape squares
    (legal king steps via null-move view), king-zone attacks, pocket, hanging pieces (legally
    capturable + undefended), attacked Q/R, drop-check squares per pocket piece, mate-in-one,
    opponent mate-in-one threats. Move: check/mate/capture (promoted capture marked `X~`)/drop/
    promotion/discovered check, attacked K/Q/R, opponent king escapes before→after, pocket
    before→after, reply count + forced replies (≤3), tags (drop_check, drop_mate, queen_drop,
    interposition_drop, knight_fork, double_attack, escape_square_reduction, …). PV: per-ply
    check/drop + mover's consecutive checks. `POST /api/insights` → Insights.
  - Engine supersede policy: only a request for a DIFFERENT position stops the running search
    (generation bump); same-position requests with other settings queue (found by E2E: the UI's
    quick look used to cancel a user's explain request).
  - `app/llm/`: `provider.py` (`LLMProvider` protocol; `AnthropicProvider` = official SDK,
    `claude-opus-5-5`, effort medium, `fallbacks="default"` + beta `server-side-fallback-2026-07-01`,
    refusal handled, typed error chain → safe Chinese messages, key only from env/.env;
    `FakeProvider` echoes the context for tests), `system_prompt.md` (task.md §19/§20/§33/§34),
    `context.py` (task.md §18 context built server-side from the line + engine + analyzer;
    PGN comments/headers passed as data; `<`/`>` escaped so untrusted text cannot close the
    `<position_context>` block; client `game_move` re-validated, dropped if illegal),
    `service.py` (cache key = context (incl. position_id, variation_id, analysis_id) + question +
    history + model + context/prompt versions). `POST /api/explain` (503 llm_unavailable, 502
    llm_error, 409 position mismatch / engine superseded). `LLM_PROVIDER` anthropic|fake|none.
  - `app/llm/candidates.py` (task.md §22): moves named in a question (SAN/UCI/drop/castling, CJK
    neighbours ok; bare squares only if a legal pawn move; max 3) → legality (illegal → Chinese
    reason) → MultiPV hit, or engine analysis of the position after the move (same multipv/movetime)
    → move facts → `candidate_analysis` in the LLM context. If every named move is illegal the
    answer comes from the rules (`model: "rules"`), no engine, no LLM. Response `checked_moves`.
  - User-facing illegal-move reasons in chess_core are Traditional Chinese.
  - `app/review.py` + `routers/review.py`: whole-game review jobs (`POST /api/review`, `GET
    /api/review/{id}`, in-memory, deduped by line) on a SECOND engine process (2 threads,
    REVIEW_MOVETIME_MS=300) so it never supersedes interactive analysis. Each played move that
    differs from the engine's best is searched from the SAME position with `root_moves=[played]`
    (UCI searchmoves) — comparing positions before/after with separate short searches produced
    alternating fake blunders (side-to-move bias, found via screenshot). Verdicts: lichess
    winning-chance drop 0.1/0.2/0.3 on cp×0.5 (crazyhouse scale heuristic) + mate-aware
    (mate_missed, mate_allowed; downgraded/ignored when the position is already decisive).
  - `EngineService.analyse(..., root_moves=())` — part of the cache key.
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
    via `playLine`), `engineShapes.ts` (arrows; drops = circle, best drop also a ghost piece).
  - `src/llmRequest.ts`: tree → LLM metadata (variation_id, on_main_line, the game's move here or
    at the branch point, PGN comments on the path, headers). `src/useConversation.ts`: turns per
    (position_id, variation_id); answers land in the thread they were asked in (late answers never
    show on another position); follow-ups send the last 6 Q/A turns. AnswerView + RichText
    (safe minimal markdown). WhyPanel has an on-demand 「AI 解釋」 button.
  - ChatPanel ("Ask about this position"): quick questions (task.md §23, built with the actual best /
    second / game-move SAN) and free questions on the same `/api/explain` pipeline; shows
    checked moves (illegal reason / engine score + source) above each answer.
  - `useGameReview` (start + poll; shown only for the exact main line analysed), move-list glyphs
    (?! ? ?? ?# ??#) with best-vs-played tooltip, ReviewPanel (critical moments, clickable).
  - EvalGraph (`src/evalGraph.ts` geometry + component): White winning chances per main-line ply
    (same curve/scale as backend), white wash above / dark below the midline, status-colored dots
    on flagged moves (status tokens in index.css, always with glyph + label), crosshair tooltip,
    click to jump, active-ply line.
  - `src/useInsights.ts` fetches insights once the engine result is final (keyed by
    position_id + analysis_id); `src/explain.ts` turns facts into fact-only Traditional Chinese
    sentences (direct effect, king safety, replies, PV, pocket, candidate comparison in mover POV,
    alerts); `WhyPanel` renders them (or the last move when the game is over).
  - Vite dev server :5180 proxies `/api` → backend :8820. `scripts/serve.sh` builds the UI and
    the backend serves `frontend/dist` at `/` (StaticFiles mounted after the API routes).
  - Click-to-drop: pocket click toggles a selection mirrored into chessground's drop mode; one
    board click per selection, then re-sync (an occupied-square click leaves chessground's
    off-board placeholder otherwise); Esc cancels.

## Completed features
- Crazyhouse canonical state, move parsing (UCI or SAN) with human-readable illegal reasons.
- PGN import with variations/comments.
- UI: PGN load, board + pockets, move list with variations/comments, navigation, flip.
- Interaction: drag moves, pocket drag/drop with legal-square highlight, promotion chooser
  (cancel restores), typed moves, user variations (delete ×), 「回到主線」.
- Engine: Fairy-Stockfish analysis of the active position, MultiPV 3, mate scores, arrows/drop
  markers, click-to-play PV.
- "Why this move?" panel: deterministic explanation of the best move + candidate comparison +
  position alerts (mate threats, hanging pieces), all traceable to engine output or rules.
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
- Review verdicts come from 300 ms searches: bullet-game classifications vary a little between runs.
- No touch E2E coverage.
- Engine: single shared process; two browser tabs analysing at once cancel each other's searches.
  No streaming (two fixed-length phases). Classical eval only (NNUE net not installed).
- Analyzer does not yet detect: opened files/diagonals, line blocks, multi-move mate threats,
  king-zone pressure scores. "Why" panel is fact-only (no strategic interpretation) until the LLM.
- LLM: real Claude output never exercised here (no key). E2E uses LLM_PROVIDER=fake.
- If the user asks AI about position A and navigates to B before A's engine search finishes,
  A's search can be superseded → that turn shows "請再問一次".
- One E2E failure seen once (engine.spec drop-mate test, a toContainText) right after a backend
  change; not reproduced in 8 later runs incl. --repeat-each stress. Watch for recurrence.

## Verification status
- `cd backend && uv run pytest -q` → 130 passed (review classification incl. mate edge cases, review
  job on a real game without disturbing interactive analysis, root_moves) (candidate extraction forms; MultiPV vs fresh engine
  analysis; illegal-only answered by rules without engine/LLM; mixed legal/illegal) (LLM: context == board/engine/analyzer, variation
  context, prompt-injection boundary, cache key separation, missing key 503, key never in errors,
  refusal handling via stubbed SDK client — no real API call) (incl. analyzer facts consistent with canonical state
  on every ply of the real games; insights analysis_id == analyze analysis_id) (incl. real Fairy-Stockfish: drop mates both colors,
  supersede race (deterministic; proven to fail without the fix), crash restart, and FSF `d`/`perft 1`
  vs python-chess FEN + legal-move set for all 174 plies of the 3 real games — identical).
- `cd frontend && npx vitest run` → 30 passed; `npx tsc -b`, `npm run lint`, `npx vite build` clean.
- `cd frontend && npx playwright test` → 18 passed (incl. click-to-drop) (review: annotations only on main line, critical
  list == flagged moves, click selects the move; eval graph dots == flagged moves, hover tooltip,
  click jumps to the nearest ply) (core flow §55: PGN → engine → why → AI → ask
  "為什麼不是 Qh5？" → play Qh5 → re-analysis → ask "現在黑方怎麼反擊？" answered for the variation →
  back to main line with PGN unchanged and the original thread restored) (fake LLM: answer echoes exactly the board's
  position_id/FEN and the displayed analysis_id; late answer never shown on another position;
  variation context; why panel uses the displayed engine result's
  analysis_id; drop mate explanation; mate-threat alert; engine: drop mate #1/#-1, drop marker, PV click,
  engine panel position_id always == board position_id during fast navigation) (real backend :8821 + vite :5181, fresh servers;
  DOM board/pockets compared square-by-square to backend FEN; real mouse drags incl. pocket
  drops, flipped board, illegal pawn drop rollback, promotion → captured → pawn in pocket).
- Real-data cross-check: 3 finished lichess crazyhouse games (fixtures) reach lichess's own
  final FEN (board, pocket, side, castling). Ongoing TV games mismatch only because lichess
  delays published moves of games in progress (not a rules issue).

## Last successful commands
- `PORT=8830 ./scripts/serve.sh` (single process; browser smoke: board + engine best move, 0 console errors)
- `cd backend && uv run pytest -q`
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820`
- `cd frontend && npx vite --host 127.0.0.1 --port 5180`
- `cd frontend && npx playwright test` (starts its own servers on 8821/5181)

## Next recommended task
1. (Needs the user) Verify real Claude answers with an ANTHROPIC_API_KEY in `.env`: run
   `scripts/llm_smoke.py`-style check on a known position and review grounding/POV/language.
2. UI polish: engine on/off toggle, streaming LLM answers, keyboard access to pockets.

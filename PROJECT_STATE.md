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
  - `pgn_import.export_pgn` + `POST /api/export`: tree nodes (pre-order, main first) → PGN via
    python-chess; every move re-validated by replay; Variant/SetUp/FEN tags set; comment braces
    stripped by python-chess. Frontend ExportPanel (copy / download .pgn), round-trip tested.
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
    Line facts per move: `discovered_attacks` (enemy pieces newly attacked by the mover's other
    sliders), `blocked_lines` (enemy slider attacks on mover pieces cut by the moved/dropped piece),
    `opened_file` (pawn capture leaving the file open / half-open), `threatens_mate` (mate-in-one
    next if the opponent passed). Position `threat`: engine search of the null-move position
    (`run_threat`, THREAT_MOVETIME_MS=400, skipped in check) — also in the LLM context.
    Also: `defenses_to_mate_threats` (moves after which the opponent has no mate in one; quiet drops,
    quiet moves, then checks — checks only postpone), `en_prise_to` (opponent pieces that can take
    the moved piece at a profit → it would go to their pocket), tags `piece_en_prise`,
    `pocket_emptied`; per side `king_zone_attackers`, `board_material`.
    Note when writing analyzer tests: pocket pieces change what is mate (a piece in hand can block),
    which invalidated several hand-made test assumptions — compute, don't assume.
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
    Providers are streaming-first (`stream()` yields text deltas then one LLMResult; Anthropic via
    `client.beta.messages.stream` + `text_stream` + `get_final_message`; refused chain → partial
    discarded). `POST /api/explain/stream` = SSE `meta`/`delta`/`done`/`error`; validation/engine
    errors are plain HTTP errors before the stream opens; cache hits send meta + done only.
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
    show on another position); follow-ups send the last 6 Q/A turns. Answers stream (`readSse`
    over fetch, TextDecoder streaming mode) and render progressively.
  - Auto-explain (opt-in, `src/preferences.ts` localStorage booleans): asks the default question
    only after the active position's analysis is done AND the user stayed 1.5 s; one request per
    thread (answers/cache are reused). Arrow keys navigate unless a text field/select is focused.
  - Session restore (`src/session.ts`): localStorage keeps only the source (PGN text / FEN) and the
    UCI lines of user-created nodes + the active line; on load `restore()` re-imports the source and
    replays user moves through `/api/move` (backend validates everything), then selects the active
    line. Superseded vs failed restores are distinguished (StrictMode double mount); a failed or
    corrupt session falls back to a new game and is cleared.
  - LLM requests carry `viewer_side` (board orientation); context `game.viewer_side` (ctx-v2) and the
    system prompt say "我/我的" = viewer side (else side to move), and to say so when the named
    piece does not exist instead of guessing. AnswerView + RichText
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
  - Touch: chessground cancels touchend's default, so taps never become clicks → Pocket detects
    taps itself (touchstart→touchend < 10px) and ignores a compatibility click within 600 ms.
    Pocket slots are role=button (tabindex only when usable), Enter/Space picks; typed drops
    (MoveInput "N@d6") complete it from the keyboard.
  - Loader accepts PGN or a one-line crazyhouse FEN (`looksLikeFen`; bracket or lichess "/pocket"
    style, normalized by the backend). Engine on/off switch (localStorage preference, try/catch).

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
- Board squares themselves are not keyboard-navigable (moves/drops by keyboard go through the
  move input).
- Engine: single shared process; two browser tabs analysing at once cancel each other's searches.
  No streaming (two fixed-length phases). Classical eval only (NNUE net not installed).
- Analyzer reports king-zone attackers but no weighted pressure score; opened diagonals are covered
  only through discovered attacks; "tempo" is expressed only through checks/forced replies. "Why" panel is fact-only (no strategic interpretation) until the LLM.
- LLM: real Claude output never exercised here (no key). E2E uses LLM_PROVIDER=fake.
- If the user asks AI about position A and navigates to B before A's engine search finishes,
  A's search can be superseded → that turn shows "請再問一次".
- (Resolved) The intermittent engine.spec failure was a wrong test expectation (ply 1 instead of 2
  for a black-to-move FEN) that passed only when the assertion ran before the move landed.

## Verification status
- `cd backend && uv run pytest -q` → 147 passed (incl. PGN export round trip). Rules suite (drops, pawn ranks, drop mates, promoted
  capture → pawn, FEN round trip, castling rights); 3 real lichess games reach lichess's final FEN;
  real Fairy-Stockfish: drop mates both colors, White-POV signs, supersede race (deterministic, proven
  to fail without the fix), crash restart, root_moves, FSF `d`/`perft 1` == python-chess FEN and
  legal moves on all 174 real plies; analyzer facts (exact positions + every real ply); insights use
  the same analysis_id as analyze; null-move threats; review classification incl. mate edge cases and
  a real-game job not disturbing interactive analysis; LLM context == board/engine/analyzer, variation
  and viewer side, prompt-injection boundary, cache keys, candidate-move flow, SSE events, missing-key
  503, key never in errors, refusal/fallback via stubbed SDK streams. No real Claude call.
- `cd frontend && npx vitest run` → 41 passed; `npx tsc -b`, `npm run lint`, `npx vite build` clean.
- `cd frontend && npx playwright test` → 28 passed. Real backend + real Fairy-Stockfish + vite, fresh
  servers on 8821/5181, LLM_PROVIDER=fake. Covers: DOM board/pockets == backend FEN square-by-square
  (all 83 plies of a real game); mouse, click-to-drop, touch (tap + CDP drags) and keyboard input;
  illegal drop rollback; promotion → captured → pawn in pocket; variations / main line preservation;
  engine drop mates (#1/#-1), drop markers, engine output bound to the active position during fast
  navigation; why panel facts on the displayed analysis_id; mate-threat alerts and defenses; fake-LLM
  answers echo the exact board position/FEN/variation; late answers never shown elsewhere; the §55
  core flow; whole-game review annotations + eval graph; FEN load; engine toggle; auto-explain (15
  fast plies → zero LLM requests, dwell → exactly one); viewer side; session restore after reload;
  PGN export → download → re-import gives the same move tree.
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
2. With a key: measure real latency/cost per answer and tune effort (medium default) / caching.

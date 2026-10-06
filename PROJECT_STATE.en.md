<p align="right">
  <a href="PROJECT_STATE.md"><img alt="繁體中文" src="https://img.shields.io/badge/%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-6e7781?style=for-the-badge"></a>
  <a href="PROJECT_STATE.en.md"><img alt="English" src="https://img.shields.io/badge/English-0969da?style=for-the-badge"></a>
</p>

# PROJECT_STATE

Persistent handoff between agent loops. Read before PLAN, update after FINAL — this English
version and the Traditional Chinese `PROJECT_STATE.md` together, in the same commit.
Task spec: `task.md` (Chinese original) / `task.en.md` (English translation).

## Current milestone
Milestone 1 DONE (PGN → board → navigation → pockets → rules → variations).
Milestone 2 DONE (Fairy-Stockfish → White-POV eval → best move → MultiPV 3 → PV, arrows).
Milestone 3: Analyzer + deterministic "Why this move?" DONE; LLM layer DONE and verified with real
answers through the local agy CLI (Gemini 3.8 Flash High). Claude path still unverified (no key).
Milestone 4 (chat + candidate re-analysis + variation-aware Q&A) DONE; the task.md §55 core flow
passes end-to-end with the fake LLM (e2e/core-flow.spec.ts) and real answers pass via agy.
Whole-game review (critical moves, task.md §30) + eval graph DONE.
Lichess-style engine settings + streamed analysis DONE (user request after task.md, 2026-10-06).
Anti-hallucination layer (answer checks, model-input viewer, real-LLM eval) and whole-game scans of
each side's errors DONE (user requests, 2026-10-07).

## Current task status
Strict verification against task.md (2026-10-06) found and fixed: stale README/PROJECT_STATE,
LLM context missing §7/§18 fields, no attacked/defended squares (§15), no engine depth cap (§10),
named moves beyond 3 reaching the LLM unchecked (§20/§22), grounding counting the question / PGN
comments as evidence, SAN used as React keys (§9). Then: LAN access (systemd user service,
192.168.0.0/24 allowlist) and lichess-like engine settings (lines, depth limit, time incl.
infinite, threads, hash; streamed snapshots; stop; facts/LLM bound to the displayed analysis_id).
Then: bilingual documentation (Traditional Chinese + English, switch buttons at the top).
Then (user report "free questions cannot be sent"): Send and quick questions were disabled while
any answer of the position was pending, including the AI explanation (agy: 30–60 s, often started
by dwell auto-explain) — now only an identical waiting question is blocked. Also fixed: candidate
searches used the displayed search time unbounded (60 s setting → up to 3 min before the LLM),
explanations without a displayed result used the review engine's 1 line / 300 ms, and a stream
cancelled while its search was starting left an orphaned search occupying the engine (python-chess
still sends `go`; infinite → up to 10 min).
Then (user worried about hallucinations): answer checks for moves / evaluations / mates / advantage,
「AI 看到的資料」 viewer, tighter system prompt, real-LLM eval (`scripts/llm_eval.py`); and whole-game
scan buttons (「全局掃描：白方／黑方 miss 的錯誤」).
NEXT (requested, not started): let the user pick the AI source — agy / codex / claude CLI subscriptions —
plus model and effort, enumerated live from each CLI every time (see Next recommended task).

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
    different request supersedes.
  - Streamed analysis with per-request `SearchSettings` (multipv 1–5, depth cap|None, movetime
    100 ms–10 min|None = infinite, threads 1–(cpus−1), hash 16–4096 MB): `EngineService.stream()`
    configures Threads/Hash before each search, yields `running` snapshots (every 0.25 s or on a
    depth increase; nodes/nps/elapsed/settings), ends `ok` (limit reached or `stop(position_id)`)
    or `cancelled` (superseded, not cached); infinite searches capped at 10 min and never cached
    (a revisit resumes searching). Every result and
    snapshot is remembered by `analysis_id` (LRU 512, `find()`). `POST /api/analyze/stream` (SSE
    `snapshot`/`done`/`error`), `POST /api/analyze/stop`. A stream cancelled while its search is
    starting lets the start finish (shielded), stops it at once, and the next command waits for
    that start (`_abandoned`, in `_ensure_started`): python-chess would otherwise begin the search
    after the cancellation with nobody to stop it.
  - `/api/insights` and `/api/explain(/stream)` take the displayed `analysis_id` and reuse exactly
    that result (`resolve_analysis`: interactive engine, then review engine); without one they search
    on the review engine (protected) with the interactive defaults (3 lines, ENGINE_MOVETIME_MS).
    Candidate searches take the displayed search time capped at ENGINE_MAX_MOVETIME_MS (infinite →
    ENGINE_MOVETIME_MS). Candidate/threat searches always run on the review engine, so
    facts and questions never interrupt the viewer's analysis. Insights carry `engine_status`
    (incl. `running`) and `depth`.
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
    quick look used to cancel a user's explain request). `protected=True` searches (explain, its
    candidate moves and threat) never stop others and are never stopped — browsing queues behind
    them; a protected caller that joined a superseded shared search re-runs it.
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
  - `AgyProvider` (provider.py): user's choice when no Anthropic key — runs `agy -p <prompt> --model
    gemini-3.8-flash-high --output-format stream-json --mode plan --sandbox --print-timeout` with no
    shell, cwd = private empty temp dir; prompt = system prompt + "no tools" rule + prior turns +
    question (agy has no system role; data boundary still holds via escaped `<position_context>`).
    Parses `step_update.text_delta` (agent_response) and the final `result` (SUCCESS/ERROR); exit 1/3,
    timeout (print-timeout + AGY_GRACE_S) → LLMError, login/auth errors → LLMUnavailable; process
    killed if the stream is closed early; stderr drained concurrently. Do NOT add
    `--disable-slash-commands`: agy then ignores `--mode plan`. `LLM_PROVIDER=auto` default.
    Recorded real output: `tests/fixtures/agy_stream_*.ndjson`.
  - `app/llm/grounding.py` `check_answer(answer, context, board|None)` → `ExplainResponse.warnings`
    (`AnswerWarning{kind, quote, detail}`): `illegal_move` (not legal now, not in the context);
    `unanalysed_move` (legal now, named-but-not-analysed, or the LLM's own continuation — legal after a
    null move or after an engine first move; with board None (game scan) any move missing from the
    data); `evaluation` (signed number matching no context evaluation by absolute value, ±0.15 / ±0.5 for
    whole numbers; "mate -1" skipped); `mate` ("N 步殺 / mate in N / #N / M N" longer than any context
    mate, mate-in-one lists and `threatens_mate_in_one_next` count as 1; Chinese claims only when the
    clause names a side or a move); `advantage` ("白方優勢 / 對黑方有利 …" with no evaluation ≥ 0.2 for
    that side). Negations earlier in the same clause skip a claim. Evidence excludes user_question,
    PGN comments/headers and not-analysed candidates; rule drop checks ("N@h6") count as evidence.
    Every answer also carries `prompt` (`PromptRecord{system, messages}`, built by
    `service.build_messages`, exactly what the provider receives; None for rules answers), shown in
    AnswerView as 「AI 看到的資料」. `scripts/llm_smoke.py`: 4 fixed cases against the REAL provider
    (answered, mostly Chinese, no warnings, on topic). `scripts/llm_eval.py`: 14 positions (4 per
    lichess fixture game + 2 tactics) × (default explanation + a quick question), report + JSON with each
    answer's context in `backend/reports/` (git-ignored); `--recheck file.json` re-applies the checks
    without the LLM.
  - `app/llm/game_scan.py` + `POST /api/explain/game/stream` (`GameScanRequest{line, side, headers}`):
    starts or reuses the whole-game review job, SSE `progress` until it is done, then the side's flagged
    moves (most severe 12, game order; mover from ply parity of the root) with fen/pockets before, the
    engine's best line and the line after the played move (review engine, cached searches, protected),
    and move facts of both → context `task: "game_scan"` (system prompt has a 「整局掃描」 section); no
    flagged move → rules answer without LLM. Response = ExplainResponse (analysis_id = review job id,
    warnings via check_answer(board=None), prompt).
  - `app/llm/candidates.py` (task.md §22): moves named in a question (SAN/UCI/drop/castling, CJK
    neighbours ok; bare squares only if a legal pawn move; up to 10) → legality for all (illegal →
    Chinese reason) → MultiPV hit (free), or a fresh engine search of the position after the move
    (same multipv/movetime, at most 3 per question; further legal moves → `not_analyzed`) → move
    facts → `candidate_analysis` in the LLM context. If every named move is illegal the answer comes
    from the rules (`model: "rules"`), no engine, no LLM. Response `checked_moves`.
    Grounding excludes `user_question`, PGN comments/headers and not-analysed moves from evidence.
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
    build here, sha256 9c8ff22d…) + crazyhouse NNUE `engines/crazyhouse-8ebf84784ad2.nnue` (55.8 MB,
    +1136 Elo vs classical per fairy-stockfish.github.io/nnue; sha256 prefix verified; license of
    this 2022 net not stated → downloaded locally, never committed). `EngineSettings.eval_file`
    (ENGINE_EVAL_FILE, empty = classical); engine name ends with " NNUE"/" classical" so analysis_id
    and caches never mix the two. Verified NNUE is active through python-chess (FSF info string).
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
  - `src/useEngine.ts`: debounce 120 ms, one streamed search with the viewer's settings
    (`src/engineSettings.ts`, localStorage, sanitized to the offered options); key = position_id +
    settings + restart nonce; abort on change closes the stream (server stops the search); status
    analyzing/done/stopped/error; long searches (≥10 s or infinite) publish depth milestones
    (10, 15, 20, …) for the fact panel. A result is exposed only for its own key/position.
  - EnginePanel ⚙ → `EngineSettings` form; progress line "depth d / cap · nps · elapsed / limit";
    stop (keeps result) and 重新分析 "analyse again" (after an interruption/error).
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
    system prompt say "我/我的" ("I/my") = viewer side (else side to move), and to say so when the named
    piece does not exist instead of guessing. AnswerView + RichText
    (safe minimal markdown). WhyPanel has an on-demand 「AI 解釋」 (AI explanation) button.
  - `src/useGameScan.ts`: per main line (root_fen + moves) and side: pending / review progress / partial
    / answer; a changed main line aborts and hides scans; requests guarded by id. App starts the review
    panel's own review too (same backend job), ChatPanel shows the two scan buttons and results.
  - ChatPanel ("Ask about this position"): quick questions (task.md §23, built with the actual best /
    second / game-move SAN) and free questions on the same `/api/explain` pipeline; shows
    checked moves (illegal reason / engine score + source) above each answer. Asking never waits
    for other pending answers (several can be in flight; follow-up history only carries answered
    turns); only an identical question that is still waiting cannot be sent again.
  - `useGameReview` (start + poll; shown only for the exact main line analysed), move-list glyphs
    (?! ? ?? ?# ??#) with best-vs-played tooltip, ReviewPanel (critical moments, clickable).
  - EvalGraph (`src/evalGraph.ts` geometry + component): White winning chances per main-line ply
    (same curve/scale as backend), white wash above / dark below the midline, status-colored dots
    on flagged moves (status tokens in index.css, always with glyph + label), crosshair tooltip,
    click to jump, active-ply line.
  - `src/useInsights.ts` fetches insights for the final result, or the latest milestone of a long
    search, passing its analysis_id (keyed by position_id + analysis_id; the previous facts of the
    same position stay visible while newer ones load); WhyPanel names the depth. `src/explain.ts` turns facts into fact-only Traditional Chinese
    sentences (direct effect, king safety, replies, PV, pocket, candidate comparison in mover POV,
    alerts); `WhyPanel` renders them (or the last move when the game is over).
  - Vite dev server :5180 proxies `/api` → backend :8820.
  - LAN deployment: `scripts/install_service.sh` → systemd user service `crazyhouse-review`
    (enabled, Linger=yes so it starts at boot) running `scripts/run_server.sh` with HOST=0.0.0.0,
    PORT=8820, ALLOWED_CLIENT_NETWORKS=127.0.0.0/8,::1/128,192.168.0.0/24. `app/access.py`
    (pure ASGI) answers 403 to any other peer address (X-Forwarded-For ignored): verified Tailscale
    source 100.70.168.53 → 403 and a Docker container (172.17.0.3) → 403 — Docker bridge traffic
    reaches the port despite ufw, so the app-level allowlist matters. ufw (default DROP) needs
    `sudo ufw allow from 192.168.0.0/24 to any port 8820 proto tcp` (user runs it; no sudo here). `scripts/serve.sh` builds the UI and
    the backend serves `frontend/dist` at `/` (StaticFiles mounted after the API routes).
  - Click-to-drop: pocket click toggles a selection mirrored into chessground's drop mode; one
    board click per selection, then re-sync (an occupied-square click leaves chessground's
    off-board placeholder otherwise); Esc cancels.
  - Touch: chessground cancels touchend's default, so taps never become clicks → Pocket detects
    taps itself (touchstart→touchend < 10px) and ignores a compatibility click within 600 ms.
    Pocket slots are role=button (tabindex only when usable), Enter/Space picks; typed drops
    (MoveInput "N@d6") complete it from the keyboard.
  - Keyboard board (`src/keyboardBoard.ts` + ReviewBoard): the board wrap is focusable
    (role=application); the first key reveals a cursor (mouse users never see it), arrows move it
    orientation-aware and do NOT navigate the move list while the board has focus, Enter/Space =
    chessground selectSquare (select / move, promotion dialog as usual) or drops a picked pocket
    piece, Esc cancels; an aria-live region announces square + piece.
  - Loader accepts PGN or a one-line crazyhouse FEN (`looksLikeFen`; bracket or lichess "/pocket"
    style, normalized by the backend). Engine on/off switch (localStorage preference, try/catch).

## Completed features
- Crazyhouse canonical state, move parsing (UCI or SAN) with Chinese illegal-move reasons.
- PGN import (variations/comments) and direct crazyhouse FEN load; PGN export (copy/download).
- UI: board + pockets, move list with variations/comments, navigation, flip; session restore after
  reload.
- Interaction: mouse drag, pocket drag/click-to-drop, touch (tap-to-drop, drags), keyboard board
  cursor + typed moves; promotion chooser; user variations (delete ×), 「回到主線」 (back to main line). Undo/redo =
  ◀/▶ navigation (nothing is lost) + × to remove a played line.
- Engine: Fairy-Stockfish 14 + crazyhouse NNUE, White-POV scores, mate scores, arrows/drop markers,
  click-to-play PV, on/off switch; null-move threat analysis; viewer settings (lines 1–5, depth
  limit, time incl. infinite, threads, hash) with live streamed depth, stop/restart.
- "Why this move?" panel: fact-only explanation (direct effect, king escapes, replies, PV, pocket,
  line effects, mate threats + defenses, pieces en prise) and candidate comparison.
- LLM: Claude or local agy; on-demand / dwell auto-explain; chat with quick questions; every named
  move legality-checked, up to 3 fresh engine searches, the rest marked not analysed; streamed
  answers; unbacked moves in answers flagged.
- Whole-game review: per-move verdicts (inaccuracy … missed/allowed mate) + clickable eval graph.
- Fresh game (no PGN): the first user line is the main line. PGN game: user moves are always
  variations; the PGN main line is never modified.

## Important decisions
- Backend is rules authority; frontend tree stores only backend-produced states.
- Canonical position (task.md §7) = backend `PositionState` + the tree node's `variation_id`;
  every LLM request serializes both together (context `position` block: position_id, variation_id,
  ply, fen, side_to_move, white/black pocket, move_history, last_move, promoted pieces).
- position_id is per line (transpositions get different ids; history matters).
- Pawn drop SAN displayed lichess-style `P@e4` (python-chess emits `@e4`).
- Port 8765 is taken on this host by another service; use 8820 for backend dev.
- Playwright uses its own ports (8821/5181) and never reuses servers (stale dev servers once
  produced false results).
- Documentation is bilingual: `X.md` (Traditional Chinese, default) + `X.en.md` (English), each
  starting with the same language switch buttons (shields.io images inside relative links; the
  current language is blue). Both versions change in the same commit. `backend/tests/test_docs.py`
  checks the pairs, the switch buttons, equal heading counts and identical command/code blocks
  (blocks with Chinese text may be translated). `backend/app/llm/system_prompt.md` is runtime LLM
  input, not documentation: never split or decorated.

## Known bugs
- none known

## Known limitations
- Review verdicts come from 300 ms searches: bullet-game classifications vary a little between runs.
- Engine: single shared interactive process; two tabs analysing different positions replace each
  other's searches (shown as 已中斷 "interrupted" + 重新分析 "analyse again"). Threads/Hash choices affect the whole machine.
- At 390 px width chessground's file coordinates overflow by 2 px (pre-existing).
- Answer checks cover moves, evaluations, mates and advantage claims only (not piece placement or other
  statements); Chinese mate claims without a side or move in the clause are not checked.
- Analyzer reports king-zone attackers but no weighted pressure score; opened diagonals are covered
  only through discovered attacks; "tempo" is expressed only through checks/forced replies. "Why" panel is fact-only (no strategic interpretation) until the LLM.
- LLM: Claude path never exercised (no key); agy answers take ~30–60 s (agy start-up + thinking;
  text arrives near the end). E2E uses LLM_PROVIDER=fake.
- (Resolved) The intermittent engine.spec failure was a wrong test expectation (ply 1 instead of 2
  for a black-to-move FEN) that passed only when the assertion ran before the move landed.

## Verification status
- `cd backend && uv run pytest -q` → 204 passed (incl. `tests/test_grounding.py` with regressions for
  every false alarm found by the real evaluations; `tests/test_game_scan.py`: one side only, most severe
  moments in game order, black-to-move roots, progress then grounded answer, cached repeat, rules answer
  without flagged moves, invalid line 422) (incl. candidate searches of a 60 s analysis capped
  by ENGINE_MAX_MOVETIME_MS, fallback explanations with 3 lines / default time, and a stream
  cancelled while its search starts leaving no orphaned search — that test timed out before the
  fix) (incl. `tests/test_docs.py`: every document has
  both languages, switch buttons, equal headings, identical command blocks — each check seen
  failing on a deliberately broken copy) (incl. `tests/test_engine_stream.py`: settings
  validation, deepening snapshots then done + cached repeat, insights by snapshot id (running and
  final), depth cap ends early, Threads/Hash applied per search, infinite + stop → ok/find and a
  revisit searches again (not cached),
  another position cancels a stream (not cached), explanations without an id leave the
  interactive engine untouched) (incl. AgyProvider against a fake executable replaying
  recorded agy output: streaming, error result, not-logged-in, timeout kill, kill on early close) (incl. PGN export round trip, answer grounding). Rules suite (drops, pawn ranks, drop mates, promoted
  capture → pawn, FEN round trip, castling rights); 3 real lichess games reach lichess's final FEN;
  real Fairy-Stockfish: drop mates both colors, White-POV signs, supersede race (deterministic, proven
  to fail without the fix), crash restart, root_moves, FSF `d`/`perft 1` == python-chess FEN and
  legal moves on all 174 real plies; analyzer facts (exact positions + every real ply); insights use
  the same analysis_id as analyze; null-move threats; review classification incl. mate edge cases and
  a real-game job not disturbing interactive analysis; LLM context == board/engine/analyzer, variation
  and viewer side, prompt-injection boundary, cache keys, candidate-move flow, SSE events, missing-key
  503, key never in errors, refusal/fallback via stubbed SDK streams. No real Claude call.
- `cd frontend && npx vitest run` → 46 passed; `npx tsc -b`, `npm run lint`, `npx vite build` clean.
- `cd frontend && npx playwright test` → 35 passed (incl. answer warnings for an unanalysed move and a
  +9.9 evaluation, 「AI 看到的資料」 with the board FEN, whole-game scans of both sides that survive
  browsing) (incl. asking a free and a quick question while
  the AI explanation is held back 4 s; a double click sends once; no server tracebacks in the run)
  (storageState presets 1 s searches;
  `e2e/engine-settings.spec.ts`: lines 1→5, depth limit 15 ends early, settings persist + reset,
  infinite analysis deepens with facts from a running milestone, stop → final facts). Real backend + real Fairy-Stockfish + vite, fresh
  servers on 8821/5181, LLM_PROVIDER=fake. Covers: DOM board/pockets == backend FEN square-by-square
  (all 83 plies of a real game); mouse, click-to-drop, touch (tap + CDP drags) and keyboard input;
  illegal drop rollback; promotion → captured → pawn in pocket; variations / main line preservation;
  engine drop mates (#1/#-1), drop markers, engine output bound to the active position during fast
  navigation; why panel facts on the displayed analysis_id; mate-threat alerts and defenses; fake-LLM
  answers echo the exact board position/FEN/variation; late answers never shown elsewhere; the §55
  core flow; whole-game review annotations + eval graph; FEN load; engine toggle; auto-explain (15
  fast plies → zero LLM requests, dwell → exactly one); viewer side; session restore after reload;
  PGN export → download → re-import gives the same move tree; an unbacked move echoed into an answer
  is flagged as unverified; asking before any engine line is shown, then browsing away, still yields
  an answer from a complete background search.
- Real-data cross-check: 3 finished lichess crazyhouse games (fixtures) reach lichess's own
  final FEN (board, pocket, side, castling). Ongoing TV games mismatch only because lichess
  delays published moves of games in progress (not a rules issue).

- Real LLM eval (agy gemini-3.8-flash-high, 2026-10-07, `scripts/llm_eval.py`, 2 × 28 answers, ~70 s
  each): run 1 → 5/28 answers with warnings, run 2 (tighter prompt) → 2/28; every warning reviewed by
  hand: all 8 were checker false alarms (fixed + regression tests; recheck of run 2 → 0/28), no
  confirmed hallucination; spot-checked unflagged answers were factually right. Real game scans (fixture
  game 3, both sides) answered from the flagged moments only, 0 warnings.
- Real LLM (agy, 2026-10-06): `cd backend && LLM_PROVIDER=agy SHOW_ANSWERS=1 uv run python
  scripts/llm_smoke.py` → 4/4 PASS (answered, Chinese, no unverified moves, on topic; White-POV
  wording correct, defenses match the analyzer). Browser via serve.sh: streamed answer, model shown,
  Qh5 re-analysed, 0 unverified. Found + fixed: answers quoted context field names; RichText now
  renders `code` and --- rules; waiting counter.

## Last successful commands
- `PORT=8830 ./scripts/serve.sh` (single process; browser smoke: board + engine best move, 0 console errors)
- `cd backend && uv run pytest -q`
- `cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8820`
- `cd frontend && npx vite --host 127.0.0.1 --port 5180`
- `cd frontend && npx playwright test` (starts its own servers on 8821/5181)

## Next recommended task
1. Optional: if an ANTHROPIC_API_KEY becomes available, run `scripts/llm_smoke.py` with
   `LLM_PROVIDER=anthropic` to verify the Claude path too.
2. REQUESTED: AI source choice. Providers: agy (`agy models` lists ids; `--effort` levels parsed from
   `agy --help`), codex (`codex debug models` JSON: slug, visibility, supported_reasoning_levels; run
   `codex exec --json --skip-git-repo-check --ephemeral -s read-only -C <empty dir> -m M -c
   model_reasoning_effort=E`, answer = `item.completed` agent_message, no deltas), claude (`claude -p
   --output-format stream-json --include-partial-messages --verbose --system-prompt S --tools ""
   --no-session-persistence --strict-mcp-config --setting-sources "" --model M --effort E`, deltas in
   stream_event content_block_delta; model aliases and effort levels parsed from `claude --help`; NOT
   `--bare`, which ignores the subscription login). Enumerate live each time, validate requests against
   the fresh catalog, fall back to the default (agy gemini-3.8-flash-high) when a stored choice vanished.
3. Optional: sharing the interactive engine across several viewers without mutual cancellation
   (e.g. one engine process per active viewer, bounded by CPU count).

All task.md requirements are implemented and tested, including real LLM answers (via agy).

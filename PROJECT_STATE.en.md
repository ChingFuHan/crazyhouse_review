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
Viewer choice of AI source (agy / codex / claude CLI subscriptions), model and effort from live CLI
catalogs DONE (user request, 2026-10-07).
Puzzle page DONE (user request, 2026-10-08): attack / defense / middlegame tactics / battle puzzles,
mined from games, saved from the review board or made by imperfect self-play; nickname accounts with
Glicko-2 ratings; export to FEN / PGN / lichess. (task.md §35 listed puzzles and ratings as early
non-goals; the user asked for them explicitly.)
AI puzzle making DONE (user request, 2026-10-08): the puzzle page's own AI choice (agy / codex / claude,
model, effort) and two modes — the agent picks among engine candidates and writes the title / hint /
explanation, or the agent designs positions that the engine checks, retrying with the reason.
Tailscale access DONE (user request, 2026-10-09): on a tailnet, the installer adds `100.64.0.0/10` to the
allowlist.
Review page "to lichess" DONE (user request, 2026-10-09): the current position on lichess's analysis board, the
whole game uploaded as a lichess imported game.
Review page improvements DONE (user request, 2026-10-09): review summary and mistake jumps, learn from
mistakes, automatic review, game info, new layout, lichess import, recent games, promote a variation.
Moving back and forth while solving and full replays DONE (user request, 2026-10-09): ⏮ ◀ ▶ ⏭ ⇅
under the puzzle board, ◀ to retry after a wrong move.
Puzzle page improvements DONE (user request, 2026-10-09): the opponent's last move and delayed replies,
retry after a wrong move, equally good moves not failed, ask the AI to explain (stored), half a point
for the hint in words, kinds drawn first, my record, library browsing with reporting, tabs.

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
Then: viewer choice of the AI CLI, model and effort, enumerated live from the CLIs (never hard-coded).
Found on the way: on a phone the move list's scrollIntoView scrolled the whole page after every move,
moving the board away mid-interaction (now only the move panel scrolls).
Then (user report "AI 回答逾時"): the user's codex whole-game scans timed out (195 s limit; codex ran
with their personal setup — xhigh default effort, caveman proxy, MCP, hooks). Codex now runs clean,
the CLI limit is 600 s (`LLM_CLI_TIMEOUT_S`), pending answers show the AI and a cancel button.
Then: the puzzle page (see architecture), and a strict check against the request: added a paste-FEN
form on the puzzle page itself, theme labels in words (no codes), the copied FEN in the common bracket
form (lichess reads both — checked in chessops and with a live lichess URL), one make-puzzles batch at a
time, E2E for reload persistence and phone width.
Then (the user asked that making puzzles use a chosen agent, both modes, with its own menu on the puzzle
page): AI puzzle making (see architecture). Fixed on the way: self-play looked for twice the requested
count after being asked for twice the count already (four times the engine time) — it now looks for
about twice once; the reason for an illegal position (e.g. two kings) was `<Status.TOO_MANY_KINGS: 4>`
and is now spelled out; a design idea can disagree with the engine's solution (seen in a real run), so
the texts are now written from the solution once accepted; freshly made puzzles might never come up
(the next puzzle comes from the nearest non-empty rating window — found through a failing E2E), so
puzzle links `#/puzzles/<id>` were added and finished jobs list their new puzzles.
Then (the user asked where the puzzle page could improve; I listed eight items from the code and the
production data and the user chose all): no puzzle of the 46 in production had an explanation, for a
1436 player 5 of the 8 puzzles in the nearest rating window were battles, puzzles started from a bare
FEN, a wrong move showed the answer at once, and the making forms sat under the solving panel. Checked
with screenshots on a copy of the production database afterwards, fixing the rating chart's cut-off top
and bottom ticks and the overlong library list (now scrolls).
Then (the user could not find 「再試一次」 and asked for stepping back as on the review page, free movement
back and forth, and a full replay once solved): the puzzle board got the review page's `NavControls` and
◀ replaced the 「再試一次」 button. Found on the way: when solved with another mate, the replay showed the
moves played but the side panel listed the engine's stored solution — it now lists the moves played and
adds the engine's solution when it differs.
Then (the user asked where the review page could improve; eight items listed, all chosen): the review
had to be started by hand and was only a long list of errors without a summary, the right column
stacked seven panels (「問 AI」 about 2000 px down on a desktop), only pasting a PGN was possible, only the
last game was remembered, and a variation could not become the main line. Desktop and phone layouts
were checked with screenshots of a fixed lichess test game, fixing "?" PGN headers shown as names (top
bar, summary, game info).
Then (the user thought the review page's "to lichess analysis" button had gone — only the puzzle page
ever had one): the status bar under the board got 「在 lichess 分析這個局面」 and 「上傳整盤到 lichess…」.
No task in progress.

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
  - AI choice: `app/llm/provider.py` `CliProvider` (shared runner: private empty temp dir, stdin or
    argv prompt, deadline = timeout + CLI_GRACE_S, kill on early close, stderr drained, auth errors →
    LLMUnavailable; timeout = `LLM_CLI_TIMEOUT_S` (600, falls back to AGY_TIMEOUT_S), message names the AI,
    the limit and what to try) with `AgyProvider` (`-p`, `--model`, `--effort`, plan mode, sandbox), `CodexProvider`
    (`exec --json --skip-git-repo-check --ephemeral -s read-only -C dir` + `CODEX_CLEAN`
    (`--ignore-user-config --ignore-rules --disable hooks/plugins/apps/shell_tool/shell_snapshot/
    multi_agent/browser_use/computer_use`) `[-m] [-c model_reasoning_effort="E"] -`, prompt on stdin, one
    complete agent_message, no partial text; ~/.codex/AGENTS.md is still read — with no tools it is inert),
    `ClaudeCliProvider` (`-p --output-format stream-json --include-partial-messages --verbose
    --system-prompt S --tools "" --no-session-persistence --strict-mcp-config --setting-sources ""
    [--model] [--effort]`, prompt on stdin; not `--bare`, which ignores the subscription login). Provider
    name = `cli:model (effort)` (part of the LLM cache key). `app/llm/catalog.py` `ProviderPool`:
    catalogs read from `agy models` + `agy --help` (help is on stderr), `codex debug models` (visibility
    "list", per-model reasoning levels; union offered for the CLI default model), `claude --help`
    (`--model` aliases, `--effort` list); cached ≤ 2 min, `GET /api/llm/catalog?refresh=true` reads
    anew; `provider(choice)` validates (re-reads once if unknown) → `ChoiceError` → 422 `llm_choice`;
    one instance per (cli, model, effort). `LlmChoice` fields are pattern-restricted (no flags).
    `ExplainRequest.llm` / `GameScanRequest.llm`; None = server default (LLM_PROVIDER).
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
  - `POST /api/review/judge` (learning from mistakes): `ReviewService.judge` compares the best line and
    `root_moves=(move,)` on the review engine with protected searches (never stopped by a running review),
    1000 ms each, reusing `classify` / `winning_chances`; a mate is always good; a finished position or an
    illegal move is a 422.
  - `EngineService.analyse(..., root_moves=())` — part of the cache key.
  - `scripts/fetch_engine.sh` → `engines/fairy-stockfish` (gitignored; fairy_sf_14 release, bmi2
    build here, sha256 9c8ff22d…) + crazyhouse NNUE `engines/crazyhouse-8ebf84784ad2.nnue` (55.8 MB,
    +1136 Elo vs classical per fairy-stockfish.github.io/nnue; sha256 prefix verified; license of
    this 2022 net not stated → downloaded locally, never committed). `EngineSettings.eval_file`
    (ENGINE_EVAL_FILE, empty = classical); engine name ends with " NNUE"/" classical" so analysis_id
    and caches never mix the two. Verified NNUE is active through python-chess (FSF info string).
- Puzzles (`backend/app/puzzles/`): `store.py` SQLite in DATA_DIR (puzzles unique per (fen, type),
  players unique nickname (nocase), attempts unique (player, puzzle) = only the first attempt is rated);
  `rating.py` Glicko-2 (paper example in tests; RD floor 45); `miner.py` on a THIRD engine process
  (`puzzle_engine_settings`, 2 threads, 500 ms, all searches protected): `unique()` = best vs second ≥ 0.35
  winning chances (review scale), mate in 1 always unique (any mate accepted), longer mates must be the
  only mate; attack (mate ≤ 7 or ≥ 0.6, not already won one move earlier), defense (null-move threat ≥ 0.5
  for the opponent, best ≥ −0.3, < 0.6), tactics (≥ 3 solver moves, ply ≥ 16, opponent threat ≥ 0.2),
  battle (ply ≥ 16, |chances| ≤ 0.35, `tense()`: both king zones attacked, both pockets non-empty with drop
  checks; 6 plies); `solution()` follows only-moves + engine replies (≤ 6, mates ≤ 7), ends on a solver move;
  `hardness()` depth-2/6 disagreement, quiet move with forcing moves available, sacrifice (en prise),
  tempting check/capture second choice → initial rating 1100 + 150·(moves−1) + 700·hardness (battle
  1400 + 600·h); `mine_line` skips positions inside a found solution. `generator.py`: self-play from
  `openings.py` (8 common lines, 6–14 plies), 120 ms searches, best / 2nd / 3rd with weights .7/.2/.1 when
  within 0.25, mined and sorted by hardness (about twice the count, for the caller to choose from).
  `agent.py` (AI puzzle making): `curate` puts the candidates (up to 12, by hardness) — position, pockets,
  solution line (SAN), the engine's top three lines with the solver's chances, difficulty signals — in an
  escaped `<puzzle_candidates>` JSON block; the agent answers JSON picks with title / hint / explanation;
  only listed ids count (no repeats), and without an AI, on failure or unusable JSON hardness picks.
  `design` sends the kind, the description and a real opening position as reference in
  `<puzzle_request>`; the agent answers `fen` / `title` / `hint` / `idea`; `miner.invalid` and
  `miner.diagnose` say why it fails (invalid FEN, illegal position, no unique solution with the gap, low
  chances, no threat, does not hold, already winning, too few moves, not balanced or tense enough, with
  the engine's top moves) and it goes back as a conversation, up to 4 attempts; once accepted, the agent
  writes the texts from the engine's solution through the same picking prompt (one candidate) — the
  design idea may not match the solution (in a real run agy's idea said "drop a knight to deflect first"
  while the solution was Qxf8#), so it is not shown; if the agent cannot write, the design's title and
  hint stay. `_write`: a title or hint
  containing the first move (SAN / UCI) or its squares is dropped; the explanation is checked with
  `check_answer` and its warnings stored; the agent (`model`) is recorded. Prompts in
  `puzzles/prompts/curate.md`, `design.md`. `store.py` adds the `title` / `hint` / `explanation` / `ai` /
  `ai_warnings` columns to an older database on start. `service.py`: next puzzle (±100 widening), stateless move
  judging (line must be a prefix of the solution), hint (counts as failure), give up, battle moves (verdict
  from same-position searches with root_moves; result vs start ±0.2), export (`lichess_fen` puts the pocket
  as a 9th rank; PGN with the solution only after an attempt), manual create (engine-checked, reason on
  refusal), background mine / generate jobs (generate takes `mode`, kind, description and `llm`;
  `chosen_provider` validates the chosen AI (422), the server default otherwise; design without an AI is
  a 422; the job keeps a `log` and the `ai` used); a hint returns the agent's words (first move only), and
  the end of a puzzle returns the explanation and its warnings; `GET /api/puzzles/{id}` opens a given
  puzzle (puzzle links), a finished job's `made` lists the stored puzzles, and a duplicate's refusal names
  the existing puzzle (`store.find`). Puzzle page improvements: `Puzzle.before_fen` / `last_move` (written
  when mining and when saving from a line; empty for older puzzles); `move` is async — any mate solves,
  a non-answer is first compared with `miner.lines(root_moves=…)` and within `EQUIVALENT_GAP` (0.1) of the
  answer returns `alternative` (not over, not rated), otherwise it fails; a retry after a failure uses
  the same API and `store.record` keeps only the first attempt, so it is unrated; `hint_level` 0 / 1 / 2 →
  `HINT_SCORES` 1 / 0.5 / 0; `explain` (`POST /api/puzzles/{id}/explain`) only for players who attempted
  it, returns a stored explanation as is, otherwise `agent.explain` (the picking prompt with one
  candidate, keeping an existing title and hint) writes it and `store.set_texts` stores it, one
  `asyncio.Lock` per puzzle; `store.next_for` draws the kinds with `random.sample` before the rating
  windows and skips disabled puzzles; `disabled` / `report` columns with report / restore endpoints,
  `counts` without disabled ones; `GET /api/puzzles` (all summaries), `GET /api/players/{nickname}/history`
  (latest 100 attempts and averages by kind). Router `routers/puzzles.py`; tests use their own DATA_DIR
  (`tests/conftest.py`), E2E a fresh tmp DATA_DIR per run.
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
  - `src/aiChoice.ts` (`useAiChoice`: stored choice, catalog on load and on opening the settings,
    `sanitizeChoice` resets what the catalog no longer offers with a notice) + `AiSettings` (⚙ in the
    Ask panel: source / model / effort selects, per-model effort lists); WhyPanel shows the current AI.
    Fake CLIs for E2E: `frontend/e2e/fake-cli/` (symlinks agy/codex/claude → fake_cli.py; catalog
    changes through `FAKE_CLI_STATE`).
  - MoveList reveals the active move by scrolling only its own panel (`revealInPanel`), never the page.
  - Cancel: `useConversation.cancel(id)` / `useGameScan.cancel(side)` abort the request (Turn shows
    CANCELLED); closing the SSE stream makes the server close the provider stream, which kills the CLI.
    Turns carry `aiLabel` (shown while waiting). E2E drag helpers scroll the board into view first.
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
  - Pages: `src/route.ts` (hash: `#/` review, `#/puzzles`), `Root.tsx` mounts only the page on screen,
    `components/Nav.tsx`. Puzzle page `src/puzzles/` (`usePlayer`, `usePuzzle`, `PuzzlePage`,
    `PuzzleLibrary`); `components/PuzzleTools.tsx` on the review page (save as puzzle, mine this game);
    `session.openInReview(pgn)` hands a puzzle to the review page; `clipboard.ts` copies with an
    execCommand fallback (navigator.clipboard is missing on the plain-http LAN origin). The 「AI 製題」
    section of `PuzzleLibrary` uses `useAiChoice('crazyhouse-review:puzzle-ai-choice')` (remembered apart
    from the review page) with the shared `AiSettings`, picks mode, kind, description and count, polls the
    job and shows its last log lines; `usePuzzle` gives hints in two stages (`hintLevel` 1 = the agent's
    words, 2 = the piece to move) and keeps the explanation and its warnings at the end;
    `#/puzzles/<id>` (read by `route.usePuzzleRoute`) and the page opens it once signed in (the effect keys on
    the nickname, not the player object, so a rating update never reloads the puzzle); 「下一題」 leaves
    the link. Tabs: `route.usePuzzleRoute()` → `{tab: solve|library|history, id}`; `PuzzlePage` holds the
    page's one AI choice (making and explaining); `usePuzzle` builds boards from the puzzle root (from
    `before_fen` + `last_move` when known): `line` (moves played, replies and a wrong move included) +
    `lineSan` + `correct` (how much of it is known right) + `cursor`; `replayTrack` = the opponent's last
    move (when known) + the line, or the solution once shown after a failure; `navigate` (◀ ▶ ⏮ ⏭ or a
    ply) only moves the cursor, and stepping back before a wrong move turns into a retry; a move at the
    cursor that matches the known-right next move just steps on, otherwise the right prefix before the
    cursor goes to the server; a battle is played only at its latest position; `INTRO_MS` 600 /
    `REPLY_MS` 500, states `intro`, `revealed`, `retrying`, `hintUsed` (decides the score), `explaining`;
    `PuzzlePage` reuses `NavControls` (flipping affects this puzzle only); `PuzzleLibrary` (list, filters, restore) +
    `PuzzleMaker` (AI making, paste a FEN); `PuzzleHistory` (`ratingGraph.ts` computes ticks and points; a
    single-series SVG with crosshair, tooltip and arrow keys).
  - Review page layout (`App.tsx`): `.review-layout`, a three-area grid (board | side / under the board |
    side; on a phone board → side → under); under the board the status (FEN, back to main), move input,
    `ReviewPanel` and `LearnPanel`; the side has `EnginePanel`, `MoveList` and the tabs 「為什麼｜問 AI｜
    對局與工具」 (kept mounted and only hidden; the choice in localStorage). `reviewSummary.ts`: lichess's
    per-move accuracy 103.1668·e^(−0.04354·win% drop)−3.1669 averaged, plus counts per kind;
    `ReviewPanel` filters by side / inaccuracies, previous / next mistake (p / n; `typing.isTyping` shared
    with `NavControls`); `useGameReview(tree, auto)` starts by itself when the main line (root_fen + moves)
    changes and has no job yet (preference `auto-review`, on by default). `useLearn`: one side's mistakes,
    blunders and mate errors from the review, `select`s the position before each; a move there goes to
    `attempt` (judge; the board always snaps back, nothing enters the game), and while practising the
    engine panel, arrows, why tab and mistake list are hidden; the answer's arrow comes from `api.move`
    on the best move's SAN. `GameInfo` + `gameInfo.ts` (`known` drops "?", time control, date, the lichess
    game). `lichess.ts`: game link / id parsing, the browser `fetch`es lichess directly (`/game/export/{id}`,
    `/api/games/user/{name}` ndjson; lichess's API sends `Access-Control-Allow-Origin: *`), 404 / 429 /
    network errors in words. `session.ts`: the 10 recent games (deduped by `sourceKey`) and the main line's
    last moves; `tree.promote` / `makeMainline` swap variationIds and `children` order, `useReview` has
    `promoteToMain` and `openRecent`, and a restore applies `makeMainline`. `LichessLinks` (status bar):
    `lichessAnalysisUrl` (the pocket as a ninth rank, the backend `lichess_fen` rule; `?color=black` from
    Black's side); the upload asks first, opens a tab during the click (so no popup blocker stops it),
    `exportPgn` then `importToLichess` (`POST /api/import`, form `pgn`), points the tab at the game and
    keeps a link, or closes the tab and says why.
  - Vite dev server :5180 proxies `/api` → backend :8820.
  - LAN deployment: `scripts/install_service.sh` → systemd user service `crazyhouse-review`
    (enabled, Linger=yes so it starts at boot) running `scripts/run_server.sh` with HOST=0.0.0.0,
    PORT=8820, ALLOWED_CLIENT_NETWORKS=127.0.0.0/8,::1/128,192.168.0.0/24, plus Tailscale's IPv4 range
    `100.64.0.0/10` when `tailscale ip -4` works (and `TAILSCALE=0` is not set; the service listens on
    IPv4 only, so no IPv6 range; who in the tailnet can connect is up to its ACLs), printing the tailnet
    IP and MagicDNS URLs. `app/access.py` (pure ASGI) answers 403 to any other peer address
    (X-Forwarded-For ignored): verified tailnet IP 100.70.168.53 and the MagicDNS name → 200 (403
    before), the LAN → 200, a Docker container → 403 — Docker bridge traffic reaches the port despite
    ufw, so the app-level allowlist matters. ufw (default DROP) needs
    `sudo ufw allow from 192.168.0.0/24 to any port 8820 proto tcp`, and if the tailnet is blocked
    `sudo ufw allow in on tailscale0 to any port 8820 proto tcp` (user runs them; no sudo here). `scripts/serve.sh` builds the UI and
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
- Accuracy is the plain average of move accuracies (lichess also weighs by volatility and uses a harmonic
  mean), so it differs a little from lichess's numbers.
- The lichess import runs in the viewer's browser, which needs internet access; recent games live only in
  that browser.
- 「上傳整盤到 lichess」 creates a public imported game and lichess keeps the main line only (variations
  and comments are dropped); anonymous imports are rate-limited by lichess.
- Engine: single shared interactive process; two tabs analysing different positions replace each
  other's searches (shown as 已中斷 "interrupted" + 重新分析 "analyse again"). Threads/Hash choices affect the whole machine.
- At 390 px width chessground's file coordinates overflow by 2 px (pre-existing).
- Puzzles: nickname accounts have no password; anyone signed in can report or restore a puzzle; a move as
  good as the answer only gets "also a good move" and snaps back (the line does not continue from it);
  only puzzles mined or saved from now on know the opponent's last move (older ones never stored it);
  making puzzles takes minutes of engine time per puzzle.
- AI puzzle making: an agent's hint is checked only for the first move or its squares (not for subtler
  give-aways); designed positions often need several attempts, and after 4 failures the puzzle is skipped
  (the job log lists each reason). Measured (2026-10-08, each CLI's default model): picking took agy
  244 s, codex 32 s, claude 24 s, all with explanations matching the data, no warnings, no give-away
  hints; designing attacks passed within 1–3 attempts for all three (mostly smothered mates), designing
  defenses failed all 4 attempts for codex and claude and passed on the 2nd for agy — the defense
  criteria (threat ≥ 0.5, a unique defense) are hard to hit from scratch. agy needs minutes per answer.
- AI choice: Codex returns its answer in one piece (no partial text while it thinks); Claude's model list
  is the aliases its `--help` names (full model names are accepted by the CLI but not listed).
- Answer checks cover moves, evaluations, mates and advantage claims only (not piece placement or other
  statements); Chinese mate claims without a side or move in the clause are not checked.
- Analyzer reports king-zone attackers but no weighted pressure score; opened diagonals are covered
  only through discovered attacks; "tempo" is expressed only through checks/forced replies. "Why" panel is fact-only (no strategic interpretation) until the LLM.
- LLM: Claude path never exercised (no key); agy answers take ~30–60 s (agy start-up + thinking;
  text arrives near the end). E2E uses LLM_PROVIDER=fake.
- (Resolved) The intermittent engine.spec failure was a wrong test expectation (ply 1 instead of 2
  for a black-to-move FEN) that passed only when the assertion ran before the move landed.

## Verification status
- `cd backend && uv run pytest -q` → 241 passed (incl. judge: a mate is good, allowing mate gives
  mate_missed / blunder with the best move, judging works during a running review, illegal 422, finished
  422) (incl. the last move stored when mining and when saving
  from a line; an equally good move neither ends nor rates, a retry after failing is unrated; hint scores
  for levels 0 / 1 / 2; explaining before an attempt 422, written once and stored, two viewers at once run
  the agent once; one puzzle of a kind against ten of another still comes up about half the time;
  reporting / restoring and skipping disabled puzzles; library and history contents) (incl. tailnet devices allowed with the tailnet range,
  Docker / other networks and a spoofed X-Forwarded-For still 403) (incl. `tests/test_puzzle_agent.py`: JSON extraction,
  give-away detection, picks only listed ids (no repeats) and drops titles / hints that give the answer
  away, explanation warnings kept, unusable answers fall back to hardness; a design hears "no JSON",
  「局面不合法：too_many_kings」 and "no unique solution" in turn and retries, then the texts are written
  from the engine's solution (not the design idea), and the design's title and hint stay when that
  fails; design without an AI 422, an invalid choice 422; older databases get the new columns; puzzle
  links, duplicate refusals naming the puzzle, a job's `made`) (one generate batch at a time checked in test_puzzles) (incl. `tests/test_puzzle_store.py` (Glicko-2 paper example,
  store, rated-once) and `tests/test_puzzles.py` (real engine: attack and defense found, solving with any
  mate accepted, replay unrated, hints, wrong move, out-of-step 422, battle to the end, manual create +
  refusal, mining a real game and generating as background jobs)) (incl. a real uvicorn server + real connection: a client
  that drops `/api/explain/stream` ends the CLI run within seconds; clean codex argv; timeout message)
  (incl. `tests/test_cli_providers.py` for all three CLIs
  against a fake executable replaying recorded real output — argv, stdin, private dir, effort flags,
  failures, login errors, timeout and early-close kills; `tests/test_llm_catalog.py`: catalog parsers on
  real help/catalog text, live re-read when a CLI update adds/drops a model, refused choices, flag
  smuggling rejected, the chosen CLI answering through /api/explain) (incl. `tests/test_grounding.py` with regressions for
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
- `cd frontend && npx vitest run` → 64 passed (incl. the lichess analysis URL; incl. the rating chart's ticks and points; accuracy and the
  summary, lichess link and ndjson parsing, time control and date, promoting and making a main line
  (nested, a user line past the game's end), recent games deduped and capped); `npx tsc -b`, `npm run lint`, `npx vite build` clean.
- `cd frontend && npx playwright test` → 56 passed (incl. `e2e/review-tools.spec.ts`: the lichess analysis
  link and Black's side after flipping, the upload asked first, cancelling sending nothing, an intercepted
  import opening a new tab and leaving a link, a 429 explained; the review starts by
  itself with its summary, Black only, n to a mistake, learning from it (a bad try named, a good one, nothing
  added to the game, the engine hidden while practising); intercepted lichess answers for a game link and a
  player's list, game info and the original game link, switching back to a recent game; a promoted
  variation kept after a reload; the three tabs fit a phone. The suite turns the automatic review off;
  the tests that need it turn it on) (incl. a solved puzzle replayed with ⏮ ▶ ⏭ from
  before the opponent's last move, the current ply highlighted in the side panel; a two-move puzzle
  (Philidor's smothered mate) moved ◀◀ ▶▶ while solving, the same move again only stepping on, then
  replayed; a wrong defense move undone with ← and solved unrated; a finished battle replayed with Home /
  End) (incl. `e2e/puzzle-page.spec.ts`: the opponent's last
  move shown first and highlighted; Codex asked to explain and the text stored, the next player seeing the
  title and the hint in words and scoring half, reporting, my record (list, chart, kinds), library filters
  and restoring; tabs fit a phone; a wrong defense move → try again solved unrated, or show the answer) (incl. `e2e/puzzle-agent.spec.ts` (fake CLIs answer
  the prompts with JSON): Codex CLI chosen in the puzzle page's own menu → design an attack, two kings
  refused first with the reason and a retry, texts written from the solution once accepted, the puzzle
  opened from the job's link with its title, maker, two-stage hint and explanation after solving,
  「下一題」 leaving the link; picking makes puzzles showing the agent's titles; the puzzle tests open
  their puzzles by link) (incl. `e2e/puzzles.spec.ts`: paste a lichess-style FEN
  as a puzzle (+ refusal reason), themes in words, rating kept after reload, phone width fits; solve a mate puzzle with
  another mating drop → rating up, solution, FEN copy, lichess popup URL, open on the review board; hint +
  wrong move on a defense puzzle; a battle to the end; save as puzzle (+ duplicate refused) and mine a game
  from the review page) (incl. cancelling a slow codex answer and a slow scan,
  then asking again) (incl. picking Codex CLI + model + effort from the
  live list and getting that CLI's answer about the board FEN, kept after reload; a CLI update dropping
  the chosen model → notice and fallback; on a phone, playing a move no longer scrolls the page) (incl. answer warnings for an unanalysed move and a
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

- Codex timing (2026-10-07, same whole-game scan prompt, gpt-6.1-sol): personal setup (xhigh, proxy, hooks)
  104 s / 2070 reasoning tokens; `--ignore-user-config` 32 s; final clean flags 32 s, 0 reasoning tokens;
  answers equally grounded. Probes: the personal hooks injected no caveman instructions in exec; RTK
  rules (AGENTS.md) load in every mode.
- Real AI CLIs (2026-10-07): live catalogs agy 14 models / 5 efforts, codex 7 models / 6 efforts,
  claude 3 aliases / 5 efforts; one real answer each — codex gpt-6.1-sol low (14 s), claude sonnet low
  (8 s), agy gemini-3.8-flash-low low (18 s) — Chinese, engine values quoted, 0 warnings.
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
2. DONE (kept for reference): AI source choice. Providers: agy (`agy models` lists ids; `--effort` levels parsed from
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

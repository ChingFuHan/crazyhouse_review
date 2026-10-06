# Crazyhouse Review

## Purpose
An interactive review board for Crazyhouse games only: load a PGN or FEN, step through the game,
play your own variations, and see Fairy-Stockfish analysis together with explanations — a
fact-only panel computed from the engine and the rules, and natural-language answers from an LLM
that is given exactly the position, pockets, variation and engine result you are looking at.
It is not a playing site, puzzle trainer, rating system or multi-variant platform.

## Architecture
- `backend/` — FastAPI + python-chess. `app/chess_core.py` is the single Crazyhouse rules
  implementation; every position is a line (`root_fen` + UCI moves) identified by `position_id`.
- `frontend/` — React + TypeScript + Vite + Chessground. Renders backend positions only; it has
  no chess rules of its own.

## Setup
Requirements: Python ≥ 3.13 with [uv](https://docs.astral.sh/uv/), Node ≥ 22, Linux x86-64.

```bash
cd backend && uv sync
cd ../frontend && npm install
cd .. && ./scripts/fetch_engine.sh   # Fairy-Stockfish 14 + crazyhouse NNUE into engines/
```

## Engine setup
Crazyhouse analysis uses [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)
(regular Stockfish cannot play crazyhouse) with the crazyhouse NNUE network from
https://fairy-stockfish.github.io/nnue/ (checksum-verified by the fetch script; set
`ENGINE_EVAL_FILE=` empty to use the classical evaluation). Settings via environment variables:
`ENGINE_PATH` (default `engines/fairy-stockfish`), `ENGINE_THREADS` (4), `ENGINE_HASH_MB` (256),
`ENGINE_MOVETIME_MS` (1500), `ENGINE_MULTIPV` (3). All evaluations are reported from White's
point of view (`evaluation` in pawns, `mate` positive when White mates).

## Run
One process (builds the UI, serves UI + API, fetches the engine if missing):
```bash
./scripts/serve.sh        # → http://127.0.0.1:8820  (PORT=... to change)
```

Development (hot reload):
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

## LLM setup
Natural-language explanations come from one of two providers (`LLM_PROVIDER=auto` picks the first
available; see `.env.example`):
- **Claude** via the official Anthropic SDK when `ANTHROPIC_API_KEY` is set in `.env` (git-ignored):
  `claude-opus-5-5`, effort `medium`, server-side refusal fallback (`fallbacks="default"`).
- **The local `agy` CLI** otherwise (uses its own login and subscription quota):
  `gemini-3.8-flash-high`, run headless per question in an empty private directory, plan mode,
  terminal sandbox, prompted not to use tools. Answers take roughly 30–60 s (shown as a counter).

Without either, everything else works and the AI button reports that no LLM is configured.
`LLM_PROVIDER=fake` is a deterministic stand-in used only by automated tests.

Every answer is post-checked: moves it mentions that are neither legal now nor part of the engine /
game data it was given are shown as unverified. To check real answers once a key is set:
```bash
cd backend && SHOW_ANSWERS=1 uv run python scripts/llm_smoke.py   # a few requests, uses credits
```

## Current features
- Crazyhouse position state (FEN with pockets and promoted markers), legal moves incl. drops
- Move input as UCI or SAN with readable illegal-move reasons
- Crazyhouse PGN import (variations and comments kept as data), or load a crazyhouse FEN directly
- Review board: PGN load, pockets, move list with variations, keyboard navigation, flip
- Play your own moves: drag pieces, drag from the pocket or click a pocket piece then a square
  (legal squares highlighted; Esc cancels); works with touch, and with the keyboard (focus the
  board: arrows move a cursor, Enter selects/moves or drops a picked pocket piece),
  promotion chooser, typed moves (SAN/UCI); your moves form variations, the PGN main line
  is never changed; 「回到主線」 returns to where you branched off

- Fairy-Stockfish analysis of the current position (switchable on/off): White-POV eval bar, best move, top 3 lines,
  arrows (drops shown as a ghost piece on the target square); click a line move to play it

- "Why this move?": a fact-only explanation of the engine's best move (drop checks, mates,
  king escape squares before/after, forced replies, main line, pocket changes) and how the other
  candidates differ, plus alerts for mate threats and hanging pieces

- 「AI 解釋」: on-demand (or, optionally, automatic after you stay on a position), streamed LLM
  explanation grounded on the same engine result and facts shown on screen, aware of the current
  variation and the game move — Claude with `ANTHROPIC_API_KEY`, or the local `agy` CLI with no key
  (see LLM setup); moves an answer mentions without backing are flagged as unverified

- "Ask about this position": quick questions and free questions about the current position or
  variation; moves you mention (e.g. 「為什麼不能 Qxe2？」「如果我改走 Qh5 呢？」) are checked for
  legality and analysed by the engine before the LLM compares them; illegal moves are answered
  by the rules directly

- 整局分析: every main-line move checked by a separate engine process; inaccuracies, mistakes,
  blunders, missed and allowed forced mates are marked in the move list and listed as critical
  moments (best vs played, both searched from the same position), with a clickable eval graph

- 匯出 PGN: the game with your variations and comments as a crazyhouse PGN (copy or download)
- Reloading the page restores the loaded game, your variations and the current position
  (stored in this browser only)

- Undo / redo: ◀ / ▶ (or ← / →) step back and forward without losing anything; a move you played
  is removed with the × next to its variation

## Known limitations
- One engine process is shared; analysing in two tabs at once cancels searches.
- Automated tests use a fake LLM; real answers are checked with `scripts/llm_smoke.py` (agy verified).

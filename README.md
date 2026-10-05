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
Requirements: Python ≥ 3.13 with [uv](https://docs.astral.sh/uv/), Node ≥ 22, Linux x86-64.

```bash
cd backend && uv sync
cd ../frontend && npm install
cd .. && ./scripts/fetch_engine.sh   # downloads Fairy-Stockfish 14 into engines/
```

## Engine setup
Crazyhouse analysis uses [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)
(regular Stockfish cannot play crazyhouse). Settings via environment variables:
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
Natural-language explanations use Claude through the official Anthropic SDK. Copy `.env.example`
to `.env` (git-ignored) and set `ANTHROPIC_API_KEY`. Defaults: `LLM_MODEL=claude-opus-5-5`,
`LLM_EFFORT=medium`; server-side refusal fallback (`fallbacks="default"`) is enabled. Without a
key everything else works and the AI button reports that the LLM is not configured.
`LLM_PROVIDER=fake` is a deterministic stand-in used only by automated tests.

## Current features
- Crazyhouse position state (FEN with pockets and promoted markers), legal moves incl. drops
- Move input as UCI or SAN with readable illegal-move reasons
- Crazyhouse PGN import (variations and comments kept as data)
- Review board: PGN load, pockets, move list with variations, keyboard navigation, flip
- Play your own moves: drag pieces, drag from the pocket or click a pocket piece then a square
  (legal squares highlighted; Esc cancels),
  promotion chooser, typed moves (SAN/UCI); your moves form variations, the PGN main line
  is never changed; 「回到主線」 returns to where you branched off

- Fairy-Stockfish analysis of the current position: White-POV eval bar, best move, top 3 lines,
  arrows (drops shown as a ghost piece on the target square); click a line move to play it

- "Why this move?": a fact-only explanation of the engine's best move (drop checks, mates,
  king escape squares before/after, forced replies, main line, pocket changes) and how the other
  candidates differ, plus alerts for mate threats and hanging pieces

- 「AI 解釋」: on-demand Claude explanation grounded on the same engine result and facts shown on
  screen, aware of the current variation and the game move (requires `ANTHROPIC_API_KEY`)

- "Ask about this position": quick questions and free questions about the current position or
  variation; moves you mention (e.g. 「為什麼不能 Qxe2？」「如果我改走 Qh5 呢？」) are checked for
  legality and analysed by the engine before the LLM compares them; illegal moves are answered
  by the rules directly

- 整局分析: every main-line move checked by a separate engine process; inaccuracies, mistakes,
  blunders, missed and allowed forced mates are marked in the move list and listed as critical
  moments (best vs played, both searched from the same position), with a clickable eval graph

## Known limitations
- One engine process is shared; analysing in two tabs at once cancels searches.
- Real Claude responses have not been verified in this repository's test runs (tests use a fake).

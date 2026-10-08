"""Making puzzles with an AI agent the viewer picks (agy / codex / claude, or the server default).

Two modes. `curate`: engine self-play finds candidates (each with an engine-verified unique solution);
the agent picks the most puzzling ones and writes a title, a hint that gives nothing away and an
explanation. `design`: the agent proposes a position of a requested kind; the rules and the engine
verify it and say exactly why it fails, and the agent tries again; once accepted, the agent writes the
texts from the engine's solution (its design idea came before that solution and may not match it).
The agent never decides what is correct: solutions, kinds and ratings always come from the engine, and
its texts get the same automatic checks as every other answer.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path

import chess

from ..chess_core import build_board, normalize_root_fen, position_state
from ..llm.candidates import MOVE_TOKEN
from ..llm.context import numbered
from ..llm.grounding import check_answer, normalize
from ..llm.provider import LLMError, LLMProvider, LLMUnavailable, complete
from .miner import MIDDLEGAME_PLY, Miner, chances, diagnose, invalid
from .models import TYPE_NAMES, Puzzle, PuzzleType

PROMPTS = Path(__file__).parent / "prompts"
CURATE_PROMPT = (PROMPTS / "curate.md").read_text(encoding="utf-8")
DESIGN_PROMPT = (PROMPTS / "design.md").read_text(encoding="utf-8")
MAX_CANDIDATES = 12
DESIGN_ATTEMPTS = 4
TITLE_LIMIT = 30

Log = Callable[[str], None]


def extract_json(text: str) -> dict | None:
    """The JSON object in an agent's answer (bare, or in a ``` block, possibly with words around it)."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    raw = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _block(tag: str, data: object) -> str:
    """Data for the agent, escaped like the explanation context so it can never close its block."""
    payload = json.dumps(data, ensure_ascii=False, indent=1).replace("<", "\\u003c").replace(">", "\\u003e")
    return f"<{tag}>\n{payload}\n</{tag}>"


def _answer_marks(puzzle: Puzzle) -> set[str]:
    """What a hint or title must not contain: the first solution move (SAN / UCI) and its squares."""
    if not puzzle.solution:
        return set()
    board = build_board(puzzle.fen, [])
    move = chess.Move.from_uci(puzzle.solution[0])
    san = board.san(move)
    marks = {normalize(san), move.uci(), chess.square_name(move.to_square)}
    if move.from_square is not None and not move.drop:
        marks.add(chess.square_name(move.from_square))
    return marks


def gives_away(text: str, puzzle: Puzzle) -> bool:
    marks = _answer_marks(puzzle)
    tokens = {normalize(t) for t in MOVE_TOKEN.findall(text)}
    return bool(marks & tokens) or any(re.search(rf"(?<![a-h]){mark}(?![1-8])", text) for mark in marks if len(mark) == 2)


async def facts(miner: Miner, index: int, puzzle: Puzzle) -> dict:
    """What the agent may know about a candidate (and what its texts are checked against)."""
    board = build_board(puzzle.fen, [])
    state = position_state(puzzle.fen, [], board)
    lines = await miner.lines(puzzle.fen, 3)
    sans: list[str] = []
    replay = board.copy()
    for uci in puzzle.solution:
        move = chess.Move.from_uci(uci)
        sans.append(replay.san(move))
        replay.push(move)
    return {
        "id": index,
        "type": puzzle.type,
        "fen": puzzle.fen,
        "solver": puzzle.solver,
        "pockets": {"white": state.pockets.white, "black": state.pockets.black},
        "solution": numbered(sans, board.ply()) if sans else None,
        "battle_moves": puzzle.battle_plies,
        "engine_lines": [
            {"move": line.pv[0].san, "evaluation": line.evaluation, "mate": line.mate, "evaluation_pov": "white",
             "solver_chances": round(chances(line, puzzle.solver), 2)}
            for line in lines
        ],
        "signals": [t for t in puzzle.themes if t in ("deep_calculation", "quiet_move", "sacrifice", "tempting_alternative")],
        "themes": puzzle.themes,
        "hardness": round(puzzle.hardness, 2),
    }


def _write(puzzle: Puzzle, title: str, hint: str, explanation: str, context: dict, agent: str) -> Puzzle:
    """A copy of the puzzle with the agent's texts: a title or hint that reveals the answer is dropped,
    and the explanation keeps the warnings of the usual answer checks."""
    puzzle = puzzle.model_copy(deep=True)
    title = title.strip()[:TITLE_LIMIT]
    puzzle.title = "" if gives_away(title, puzzle) else title
    puzzle.hint = "" if gives_away(hint, puzzle) else hint.strip()
    puzzle.explanation = explanation.strip()
    puzzle.ai_warnings = check_answer(puzzle.explanation, context, build_board(puzzle.fen, [])) if puzzle.explanation else []
    puzzle.ai = agent
    return puzzle


async def _written(provider: LLMProvider, miner: Miner, shortlist: list[Puzzle], count: int, request: str,
                   log: Log) -> list[Puzzle]:
    """Up to `count` of `shortlist` as the agent picks them, with its texts; empty (and logged) when the
    agent fails or its answer cannot be used."""
    data = [await facts(miner, i, p) for i, p in enumerate(shortlist)]
    message = _block("puzzle_candidates", data) + f"\n\n{request}"
    try:
        result = await complete(provider, CURATE_PROMPT, [{"role": "user", "content": message}])
    except (LLMError, LLMUnavailable) as error:
        log(f"AI 失敗：{error}")
        return []
    answer = extract_json(result.text) or {}
    picked: list[Puzzle] = []
    chosen: set[int] = set()
    for pick in answer.get("picks") or []:
        if not isinstance(pick, dict) or not isinstance(pick.get("id"), int) or not 0 <= pick["id"] < len(shortlist):
            continue
        if pick["id"] in chosen or len(picked) >= count:
            continue
        chosen.add(pick["id"])
        picked.append(_write(shortlist[pick["id"]], str(pick.get("title", "")), str(pick.get("hint", "")),
                             str(pick.get("explanation", "")), data[pick["id"]], result.model))
    if not picked:
        log("AI 的回覆無法使用")
    return picked


async def curate(provider: LLMProvider | None, miner: Miner, candidates: list[Puzzle], count: int, log: Log) -> list[Puzzle]:
    """The `count` most puzzling candidates as the agent sees them, with its texts; by engine hardness
    when there is no agent or its answer cannot be used."""
    by_hardness = sorted(candidates, key=lambda p: p.hardness, reverse=True)
    if provider is None or not candidates:
        log("沒有可用的 AI：依 engine 難度挑選")
        return by_hardness[:count]
    shortlist = by_hardness[:MAX_CANDIDATES]
    log(f"請 {provider.name} 從 {len(shortlist)} 個候選中挑 {count} 題")
    picked = await _written(provider, miner, shortlist, count, f"請挑出最傷腦筋的 {count} 題。", log)
    if not picked:
        log("改依 engine 難度挑選")
        return by_hardness[:count]
    log(f"AI 挑了 {len(picked)} 題")
    return picked


async def design(provider: LLMProvider, miner: Miner, kind: PuzzleType, description: str, reference: str,
                 log: Log) -> Puzzle | None:
    """One puzzle of `kind` designed by the agent, verified by the engine; None after the attempts."""
    request = {"type": kind, "type_name": TYPE_NAMES[kind], "description": description or None, "reference_fen": reference}
    messages = [{"role": "user", "content": _block("puzzle_request", request) + "\n\n請設計一題，只輸出 JSON。"}]
    for attempt in range(1, DESIGN_ATTEMPTS + 1):
        try:
            result = await complete(provider, DESIGN_PROMPT, messages)
        except (LLMError, LLMUnavailable) as error:
            log(f"AI 失敗：{error}")
            return None
        answer = extract_json(result.text) or {}
        fen = str(answer.get("fen") or "").strip()
        reason = invalid(fen) if fen else "回覆中沒有 JSON 的 fen 欄位"
        if reason is None:
            fen = normalize_root_fen(fen)
            reason = await diagnose(miner, fen, kind)
        log(f"第 {attempt} 次設計：{fen or '（沒有 FEN）'} → {'合格' if reason is None else reason}")
        if reason is None:
            puzzle = next(p for p in await miner.classify(fen, ply=MIDDLEGAME_PLY) if p.type == kind)
            puzzle.source = {"kind": "design", "description": description}
            # The design's title and hint stay if the agent cannot write from the engine's solution.
            puzzle = _write(puzzle, str(answer.get("title", "")), str(answer.get("hint", "")), "", {}, result.model)
            log(f"請 {provider.name} 依 engine 的解答撰寫標題、提示與說明")
            request = "id 0 是你設計、engine 已驗證的題目：請依資料中的解答線為它撰寫文字（設計時的構想可能與 engine 的解答不同，以資料為準）。"
            written = await _written(provider, miner, [puzzle], 1, request, log)
            return written[0] if written else puzzle
        messages += [
            {"role": "assistant", "content": result.text},
            {"role": "user", "content": f"這個局面不合格：{reason}\n請依原因修改，再輸出一次 JSON。"},
        ]
    return None

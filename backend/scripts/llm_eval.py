"""Measure how often REAL LLM answers say things the engine / rules data does not back.

Spends LLM quota: two questions per position (14 positions by default), answered one at a time.

    cd backend && uv run python scripts/llm_eval.py                 # all positions
    cd backend && uv run python scripts/llm_eval.py --limit 3       # first 3 positions only
    cd backend && LLM_PROVIDER=fake uv run python scripts/llm_eval.py --allow-fake --limit 2   # harness check
    cd backend && uv run python scripts/llm_eval.py --recheck reports/llm-eval-<time>.json      # no LLM calls

Positions: 4 points (20/40/60/80 %) of each finished lichess game in tests/fixtures plus two tactical
positions. Each position is analysed like the UI does (default engine settings), then asked the
default "explain the best move" question and one quick question, with the displayed analysis_id.
Every answer goes through the same automatic checks as in the app (unbacked moves, evaluations,
mate distances, advantage claims). The full report — position, engine result, question, answer and
warnings — is written to backend/reports/ for human review, with a JSON file that also keeps the exact
context each answer was given; `--recheck` applies the current answer checks to such a file again
(for tuning the checks without asking the model again). The summary is printed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.chess_core import STARTING_FEN, build_board  # noqa: E402
from app.llm.grounding import check_answer  # noqa: E402
from app.main import create_app  # noqa: E402
from app.pgn_import import import_pgn  # noqa: E402

GAMES = ROOT / "tests" / "fixtures" / "lichess_finished_games.json"
TACTICS = [
    ("drop mate available", "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"),
    ("mate threat to defend", "6k1/5ppp/8/8/8/8/5PPP/6K1[r] w - - 0 1"),
]
CJK = re.compile(r"[一-鿿]")


def positions() -> list[dict]:
    out = []
    for number, game in enumerate(json.loads(GAMES.read_text(encoding="utf-8")), start=1):
        node = import_pgn(game["pgn"]).root
        line = [node.state]
        while node.children:
            node = node.children[0]
            line.append(node.state)
        for share in (0.2, 0.4, 0.6, 0.8):
            index = int(len(line) * share)
            state = line[index]
            game_move = line[index + 1].last_move.uci if index + 1 < len(line) else None
            out.append({"name": f"game {number}, ply {state.ply}", "root_fen": state.root_fen,
                        "moves": state.moves, "game_move": game_move})
    out += [{"name": name, "root_fen": fen, "moves": [], "game_move": None} for name, fen in TACTICS]
    return out


def quick_question(index: int, lines: list[dict]) -> str:
    if index % 3 == 0 and len(lines) > 1:
        return f"為什麼不是 {lines[1]['pv'][0]['san']}？"
    return "對手最強反擊是什麼？" if index % 3 == 1 else "這裡需要防守什麼？"


def score(line: dict) -> str:
    return f"#{line['mate']}" if line["mate"] is not None else f"{line['evaluation']:+.2f}"


def describe_engine(analysis: dict) -> str:
    if not analysis["lines"]:
        return f"status {analysis['status']}"
    lines = "; ".join(f"{line['pv'][0]['san']} {score(line)}" for line in analysis["lines"])
    return f"depth {analysis['depth']}, White POV: {lines}"


def sent_context(answer: dict) -> dict | None:
    """The <position_context> JSON of the message the model received (its escapes are valid JSON)."""
    if not answer.get("prompt"):
        return None
    content = answer["prompt"]["messages"][-1]["content"]
    return json.loads(content.split("<position_context>\n", 1)[1].split("\n</position_context>", 1)[0])


def ask_all(cases: list[dict], allow_fake: bool) -> list[dict] | None:
    results = []
    with TestClient(create_app()) as client:
        service = client.app.state.explain
        if service.provider is None:
            print(f"LLM not available: {service.unavailable_reason}")
            return None
        if service.provider.name == "fake" and not allow_fake:
            print("LLM_PROVIDER=fake: pass --allow-fake to check the harness only")
            return None
        for index, case in enumerate(cases):
            line = {"root_fen": case["root_fen"] if case["root_fen"] != STARTING_FEN else None, "moves": case["moves"]}
            fen = client.post("/api/position", json=line).json()["fen"]
            analysis = client.post("/api/analyze", json=line).json()
            for question in (None, quick_question(index, analysis["lines"])):
                body = {**line, "question": question, "analysis_id": analysis["analysis_id"],
                        "game_move": case["game_move"], "viewer_side": "white"}
                start = time.monotonic()
                response = client.post("/api/explain", json=body)
                elapsed = time.monotonic() - start
                result = {"case": case, "fen": fen, "engine": describe_engine(analysis),
                          "question": question or "（AI 解釋：預設問題）", "elapsed": elapsed, "status": response.status_code}
                if response.status_code == 200:
                    answer = response.json()
                    result |= {"text": answer["text"], "model": answer["model"], "refused": answer["refused"],
                               "warnings": answer["warnings"], "context": sent_context(answer)}
                else:
                    result |= {"text": response.text[:500], "warnings": [], "refused": False, "context": None}
                results.append(result)
                kinds = ",".join(w["kind"] for w in result["warnings"]) or "none"
                print(f"[{len(results)}/{2 * len(cases)}] {case['name']} | {result['question']} | "
                      f"{elapsed:.0f}s | HTTP {response.status_code} | warnings: {kinds}", flush=True)
    return results


def recheck(results: list[dict]) -> None:
    """Apply the current answer checks to saved answers and the exact contexts they were given."""
    for r in results:
        if r["status"] == 200 and r["context"] is not None:
            board = build_board(r["case"]["root_fen"], r["case"]["moves"])
            r["warnings"] = [w.model_dump() for w in check_answer(r["text"], r["context"], board)]


def write_report(results: list[dict], out: Path, title: str) -> None:
    for r in results:
        r["chinese"] = len(CJK.findall(r["text"])) >= 0.3 * max(1, len(re.sub(r"\s", "", r["text"])))
    answered = [r for r in results if r["status"] == 200 and r["text"] and not r["refused"]]
    flagged = [r for r in answered if r["warnings"]]
    kinds = Counter(w["kind"] for r in answered for w in r["warnings"])
    summary = [
        f"- answers: {len(answered)} / {len(results)} (errors {sum(r['status'] != 200 for r in results)}, "
        f"refused {sum(r.get('refused', False) for r in results)}, not mostly Chinese {sum(not r['chinese'] for r in answered)})",
        f"- answers with at least one warning: {len(flagged)} / {len(answered)}"
        + (f" ({100 * len(flagged) / len(answered):.0f}%)" if answered else ""),
        f"- warnings by kind: {dict(kinds) or 'none'}",
        f"- mean time per answer: {sum(r['elapsed'] for r in results) / max(1, len(results)):.0f}s",
    ]
    report = [f"# {title}", "", *summary, ""]
    for number, r in enumerate(results, start=1):
        report += [f"## {number}. {r['case']['name']} — {r['question']}", "",
                   f"- FEN: `{r['fen']}` (moves from the start: {len(r['case']['moves'])})",
                   f"- engine: {r['engine']}",
                   f"- model: {r.get('model', '-')}, {r['elapsed']:.0f}s, HTTP {r['status']}", ""]
        report += [f"- **{w['kind']}** `{w['quote']}`: {w['detail']}" for w in r["warnings"]] or ["- no warnings"]
        report += ["", *(f"> {row}" for row in r["text"].splitlines()), ""]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(report), encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n".join(summary))
    print(f"report: {out} (+ .json)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=None, help="only the first N positions")
    parser.add_argument("--allow-fake", action="store_true", help="allow LLM_PROVIDER=fake (harness check)")
    parser.add_argument("--out", type=Path, default=None, help="report path (default backend/reports/llm-eval-<time>.md)")
    parser.add_argument("--recheck", type=Path, default=None, help="re-apply the checks to a saved .json report")
    args = parser.parse_args()

    if args.recheck:
        results = json.loads(args.recheck.read_text(encoding="utf-8"))
        recheck(results)
        out = args.out or args.recheck.with_name(args.recheck.stem + "-recheck.md")
        write_report(results, out, f"LLM eval recheck of {args.recheck.name}")
        return 0
    results = ask_all(positions()[: args.limit], args.allow_fake)
    if results is None:
        return 2
    out = args.out or ROOT / "reports" / f"llm-eval-{datetime.now():%Y%m%d-%H%M}.md"
    write_report(results, out, f"LLM eval {datetime.now():%Y-%m-%d %H:%M}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

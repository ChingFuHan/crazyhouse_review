"""Smoke-test REAL LLM answers on fixed positions (spends API credits: a handful of requests).

    cd backend && uv run python scripts/llm_smoke.py            # needs ANTHROPIC_API_KEY in ../.env
    cd backend && LLM_PROVIDER=fake uv run python scripts/llm_smoke.py --allow-fake   # harness check

Each answer must: not be refused, be mostly Chinese, get no automatic-check warning (unbacked move,
evaluation, mate or advantage claim), and mention what
the case expects (e.g. the engine's best move). Exit code 1 if any check fails.
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402

KNIGHT_TRADE_E6 = ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6"]
CJK = re.compile(r"[一-鿿]")


def cases(client: TestClient) -> list[dict]:
    second = client.post("/api/analyze", json={"moves": KNIGHT_TRADE_E6}).json()["lines"][1]["pv"][0]["san"]
    mate_fen = "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"
    mate_best = client.post("/api/analyze", json={"root_fen": mate_fen, "moves": []}).json()["best_move"]["san"]
    return [
        {"name": "drop mate: why the best move", "body": {"root_fen": mate_fen, "moves": []}, "expect": [mate_best.rstrip("#")]},
        {"name": "why not the second line", "body": {"moves": KNIGHT_TRADE_E6, "question": f"為什麼不是 {second}？"}, "expect": [second.rstrip("+#")]},
        {
            "name": "threat: what to defend",
            "body": {"root_fen": "6k1/5ppp/8/8/8/8/5PPP/6K1[r] w - - 0 1", "moves": [], "question": "這裡需要防守什麼？"},
            "expect": ["R@"],
        },
        {
            "name": "variation: black counterplay",
            "body": {"moves": [*KNIGHT_TRADE_E6, "d1h5"], "variation_id": "v:smoke", "on_main_line": False,
                     "game_move": "N@d6", "game_move_ply": 6, "question": "現在黑方怎麼反擊？"},
            "expect": ["黑"],
        },
    ]


def main() -> int:
    allow_fake = "--allow-fake" in sys.argv
    with TestClient(create_app()) as client:
        service = client.app.state.explain
        if service.provider is None:
            print(f"LLM not available: {service.unavailable_reason}")
            return 2
        if service.provider.name == "fake" and not allow_fake:
            print("LLM_PROVIDER=fake: pass --allow-fake to check the harness only")
            return 2
        failures = 0
        for case in cases(client):
            start = time.monotonic()
            response = client.post("/api/explain", json=case["body"])
            elapsed = time.monotonic() - start
            if response.status_code != 200:
                print(f"FAIL {case['name']}: HTTP {response.status_code} {response.text[:200]}")
                failures += 1
                continue
            answer = response.json()
            text = answer["text"]
            checks = {
                "answered": bool(text) and not answer["refused"],
                "chinese": len(CJK.findall(text)) >= 0.3 * max(1, len(re.sub(r"\s", "", text))),
                "grounded": not answer["warnings"],
                "on topic": all(token in text for token in case["expect"]),
            }
            ok = all(checks.values())
            failures += not ok
            flags = " ".join(f"{k}={'ok' if v else 'NO'}" for k, v in checks.items())
            print(f"{'PASS' if ok else 'FAIL'} {case['name']} ({elapsed:.1f}s, {answer['model']}): {flags}")
            for warning in answer["warnings"]:
                print(f"     {warning['kind']}: {warning['detail']}")
            if os.environ.get("SHOW_ANSWERS"):
                print("     " + text.replace("\n", "\n     "))
        return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

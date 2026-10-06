"""Whole-game scan of one side's errors: review data -> grounded LLM context -> checked answer."""

import json
import re
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.chess_core import STARTING_FEN
from app.config import engine_settings, review_engine_settings
from app.llm.game_scan import MAX_MOMENTS, flagged
from app.llm.provider import FakeProvider
from app.llm.service import ExplainService
from app.main import create_app
from app.models import ReviewJob, ReviewPly
from app.pgn_import import import_pgn

SETTINGS = replace(engine_settings(), threads=2, hash_mb=32)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")
GAMES = json.loads((Path(__file__).parent / "fixtures" / "lichess_finished_games.json").read_text(encoding="utf-8"))


def main_line(pgn: str) -> list[str]:
    node = import_pgn(pgn).root
    while node.children:
        node = node.children[0]
    return node.state.moves


def events(text: str) -> list[tuple[str, dict]]:
    out = []
    for chunk in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in chunk.splitlines())
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def ply(n: int, classification: str | None) -> ReviewPly:
    return ReviewPly(ply=n, position_id=f"p{n}", evaluation=0.0, mate=None, best_move=None, classification=classification)


def test_flagged_keeps_one_side_and_the_most_severe_moments_in_game_order():
    plies = [ply(0, None)] + [ply(n, "inaccuracy") for n in range(1, 40)]
    plies[7] = ply(7, "blunder")
    plies[8] = ply(8, "mate_missed")  # Black's move (ply 8 = moves[7], White started)
    job = ReviewJob(job_id="j", root_fen=STARTING_FEN, moves=["e2e4"] * 39, status="done", done=40, total=40, plies=plies)
    chosen, counts = flagged(job, "white")
    assert all(p.ply % 2 == 1 for p in chosen), "White played the odd plies"
    assert len(chosen) == MAX_MOMENTS and [p.ply for p in chosen] == sorted(p.ply for p in chosen)
    assert 7 in [p.ply for p in chosen], "the blunder outranks the inaccuracies"
    assert counts["blunder"] == 1 and counts["mate_missed"] == 0 and counts["inaccuracy"] == 19
    black_start = job.model_copy(update={"root_fen": "6k1/5ppp/8/8/8/8/5PPP/6K1[r] b - - 0 1"})
    assert [p.ply for p in flagged(black_start, "black")[0]][:1] == [1], "Black played first"


@needs_engine
def test_scan_streams_review_progress_then_a_grounded_answer_about_one_side():
    fake = FakeProvider()
    review = replace(review_engine_settings(), movetime_ms=50)
    moves = main_line(GAMES[2]["pgn"])
    with TestClient(create_app(SETTINGS, ExplainService(fake), review_settings=review)) as client:
        body = {"moves": moves, "side": "white", "headers": {"White": "Alice", "Comment": "ignored"}}
        with client.stream("POST", "/api/explain/game/stream", json=body) as response:
            received = events(response.read().decode())
        kinds = [kind for kind, _ in received]
        assert kinds[0] == "progress" and kinds[-1] == "done"
        progress = [data for kind, data in received if kind == "progress"]
        assert progress[-1]["done"] == progress[-1]["total"] == len(moves) + 1
        done = received[-1][1]
        if not fake.calls:
            pytest.skip("the quick review flagged no White move in this game")
        context = json.loads(re.search(r"<position_context>\n(.*?)\n</position_context>",
                                       fake.calls[-1]["messages"][-1]["content"], re.S).group(1))
        assert context["task"] == "game_scan" and context["side"] == "white"
        assert context["game"]["headers"] == {"White": "Alice"}
        assert 0 < len(context["moments"]) <= MAX_MOMENTS
        for moment in context["moments"]:
            assert re.match(r"^\d+\.[^.]", moment["move"]), f"White's move: {moment['move']}"
            assert moment["classification"] and moment["fen_before"] and moment["played"]["pv"]
        assert sum(context["review"]["counts"].values()) >= len(context["moments"])
        assert done["model"] == "fake" and done["analysis_id"] and "warnings" in done
        assert done["prompt"]["messages"] == fake.calls[-1]["messages"]
        # Asking again reuses the finished review and the cached answer.
        with client.stream("POST", "/api/explain/game/stream", json=body) as response:
            again = events(response.read().decode())
        assert again[-1][1]["cached"] and again[-1][1]["text"] == done["text"]


@needs_engine
def test_a_side_without_flagged_moves_is_answered_by_the_rules():
    fake = FakeProvider()
    with TestClient(create_app(SETTINGS, ExplainService(fake))) as client:
        with client.stream("POST", "/api/explain/game/stream", json={"moves": [], "side": "black"}) as response:
            done = events(response.read().decode())[-1]
    assert done[0] == "done" and done[1]["model"] == "rules" and "沒有發現黑方的錯誤" in done[1]["text"]
    assert done[1]["prompt"] is None and fake.calls == []


def test_invalid_lines_are_rejected_before_streaming():
    with TestClient(create_app(SETTINGS, ExplainService(FakeProvider()))) as client:
        response = client.post("/api/explain/game/stream", json={"moves": ["e2e5"], "side": "white"})
    assert response.status_code == 422

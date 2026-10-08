"""Whole-game review: mate-aware classification and the review job on a real game."""

import json
import time
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.chess_core import position_id
from app.config import engine_settings
from app.main import create_app
from app.models import EngineLine, MoveModel
from app.pgn_import import import_pgn
from app.review import classify, winning_chances

SETTINGS = replace(engine_settings(), threads=2, hash_mb=32, movetime_ms=200)
REVIEW = replace(SETTINGS, threads=2, movetime_ms=60, multipv=1)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")

MOVE = MoveModel(uci="e2e4", san="e4", from_square="e2", to="e4")


def line(evaluation=None, mate=None):
    return EngineLine(rank=1, evaluation=evaluation, mate=mate, depth=10, pv=[MOVE])


def test_winning_chances_pov():
    assert winning_chances(0, None, "white") == 0
    assert winning_chances(3.0, None, "white") == pytest.approx(-winning_chances(3.0, None, "black"))
    assert winning_chances(None, 2, "white") == 1 and winning_chances(None, 2, "black") == -1


@pytest.mark.parametrize(
    ("before", "after", "mover", "expected"),
    [
        (line(None, 3), line(5.0), "white", "mate_missed"),  # had a forced mate, now only +5
        (line(None, -3), line(-5.0), "black", "mate_missed"),
        (line(1.0), line(None, -2), "white", "mate_allowed"),  # Black now mates
        (line(-1.0), line(None, 4), "black", "mate_allowed"),
        (line(None, -4), line(None, -3), "white", None),  # already lost to a mate: not "allowed" again
        (line(3.0), line(-1.0), "white", "blunder"),
        (line(-3.0), line(1.0), "black", "blunder"),
        (line(0.0), line(-2.5), "white", "mistake"),
        (line(0.0), line(-1.2), "white", "inaccuracy"),
        (line(0.0), line(-0.8), "white", None),  # small crazyhouse swing
        (line(20.0), line(15.0), "white", None),  # still completely winning: swing does not matter
        (line(None, 2), line(None, 1), "white", None),  # mate kept
        (line(None, 7), line(55.0), "white", "inaccuracy"),  # missed mate but still overwhelming
        (line(70.0), line(None, 7), "black", None),  # Black already lost: allowing mate is not news
        (line(-3.0), line(None, 7), "black", "mate_allowed"),
    ],
)
def test_classify(before, after, mover, expected):
    assert classify(before, after, mover, played_best=False) == expected


def test_best_move_or_game_ending_move_is_never_flagged():
    assert classify(line(3.0), line(-5.0), "white", played_best=True) is None
    assert classify(line(None, 1), None, "white", played_best=False) is None


@needs_engine
def test_review_job_on_real_game_and_no_interference_with_interactive_engine():
    game = json.loads((Path(__file__).parent / "fixtures" / "lichess_finished_games.json").read_text())[2]
    tree = import_pgn(game["pgn"])
    node, moves = tree.root, []
    while node.children:
        node = node.children[0]
    moves = node.state.moves
    root = tree.root.state.root_fen
    with TestClient(create_app(SETTINGS, review_settings=REVIEW)) as client:
        job = client.post("/api/review", json={"root_fen": root, "moves": moves}).json()
        assert job["status"] == "running" and job["total"] == len(moves) + 1
        # Interactive analysis while the review runs is never cancelled by it.
        interactive = client.post("/api/analyze", json={"root_fen": root, "moves": moves[:10], "movetime_ms": 200}).json()
        assert interactive["status"] == "ok"
        assert client.post("/api/review", json={"root_fen": root, "moves": moves}).json()["job_id"] == job["job_id"]
        deadline = time.monotonic() + 60
        while job["status"] == "running" and time.monotonic() < deadline:
            time.sleep(0.2)
            job = client.get(f"/api/review/{job['job_id']}").json()
        assert job["status"] == "done", job.get("error")
        plies = job["plies"]
        assert [p["ply"] for p in plies] == list(range(len(moves) + 1))
        assert all(p["position_id"] == position_id(root, moves[: p["ply"]]) for p in plies)
        assert plies[-1]["evaluation"] is None and plies[-1]["mate"] is None  # checkmate: no engine call
        assert all(p["classification"] is None for p in plies if p["played_best"])
        assert all(p["evaluation_pov"] == "white" for p in plies)
        assert client.get("/api/review/0000000000000000").status_code == 404


@needs_engine
def test_judging_a_move_tried_in_a_position():
    # 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6??: Qxf7# is the move to find; Qxe5+ is far worse.
    moves = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6"]
    with TestClient(create_app(SETTINGS, review_settings=REVIEW)) as client:
        mate = client.post("/api/review/judge", json={"moves": moves, "move": "Qxf7#"}).json()
        assert mate["verdict"] is None and mate["played"]["san"] == "Qxf7#" and mate["chances_played"] == 1.0
        worse = client.post("/api/review/judge", json={"moves": moves, "move": "h5h4"}).json()
        assert worse["verdict"] in ("mate_missed", "blunder") and worse["best"]["san"] == "Qxf7#"
        assert worse["chances_played"] < worse["chances_best"]
        # A running whole-game review does not get in the way.
        client.post("/api/review", json={"moves": moves})
        again = client.post("/api/review/judge", json={"moves": moves, "move": "f7f5"})
        assert again.status_code == 422 and again.json()["detail"]["error"] == "illegal_move"
        over = client.post("/api/review/judge", json={"moves": [*moves, "h5f7"], "move": "e8e7"})
        assert over.status_code == 422 and over.json()["detail"]["error"] == "game_over"
        good = client.post("/api/review/judge", json={"moves": moves, "move": "h5f7"}).json()
        assert good["verdict"] is None

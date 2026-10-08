"""Puzzle page: finding puzzles with the engine, solving, battles, ratings, export, jobs."""

import asyncio
import json
import time
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.chess_core import STARTING_FEN, build_board
from app.config import engine_settings, puzzle_engine_settings
from app.engine import EngineService
from app.llm.provider import FakeProvider
from app.llm.service import ExplainService
from app.main import create_app
from app.pgn_import import import_pgn
from app.puzzles import generator
from app.puzzles.miner import Miner
from app.puzzles.models import Puzzle
from app.puzzles.openings import OPENINGS
from app.puzzles.service import lichess_fen

SETTINGS = replace(engine_settings(), threads=2, hash_mb=32)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")
GAMES = json.loads((Path(__file__).parent / "fixtures" / "lichess_finished_games.json").read_text(encoding="utf-8"))
MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"
# Found by mining fixture game 1: White must recapture on c3 with the bishop (anything else loses).
DEFENSE = "rnbq3r/ppp1kpNp/4pp2/3p4/3Pn3/P1b2N2/2PBPPPP/1R1QKB1R[p] w K - 0 11"
BALANCED = "r2q1rk1/ppp1b1pp/2b1P3/3p4/3P4/P1N2p2/1PP2P1P/R1BQR1K1[NNPbnp] w - - 0 14"


def test_openings_are_legal_lines():
    for line in OPENINGS:
        assert build_board(STARTING_FEN, line).ply() == len(line)


def test_lichess_fen_puts_the_pocket_after_the_board():
    assert lichess_fen(MATE_IN_ONE) == "6k1/5ppp/8/8/8/8/5PPP/6K1/R w - - 0 1"
    assert lichess_fen("8/8/8/8/8/8/8/K6k[] w - - 0 1") == "8/8/8/8/8/8/8/K6k/ w - - 0 1"
    assert lichess_fen(GAMES[0]["lichess_last_fen"]) == GAMES[0]["lichess_last_fen"], "already lichess style"


@needs_engine
def test_the_engine_finds_attack_and_defense_puzzles():
    async def run():
        miner = Miner(EngineService(replace(puzzle_engine_settings(), threads=2)), 400)
        mate = await miner.classify(MATE_IN_ONE, ply=0)
        defense = await miner.classify(DEFENSE, ply=20)
        start = await miner.classify(STARTING_FEN, ply=0)
        await miner.engine.close()
        return mate, defense, start

    mate, defense, start = asyncio.run(run())
    attack = next(p for p in mate if p.type == "attack")
    assert len(attack.solution) == 1 and attack.solution[0].startswith("R@") and "mate_in_1" in attack.themes
    found = next(p for p in defense if p.type == "defense")
    assert found.solution[0] == "d2c3" and found.solver == "white"
    assert start == [], "nothing to solve at the start"


def client(tmp_path, review_ms=50):
    from app.config import review_engine_settings

    return TestClient(create_app(
        SETTINGS, ExplainService(FakeProvider()), replace(review_engine_settings(), movetime_ms=review_ms),
        puzzle_db=tmp_path / "puzzles.db",
    ))  # fmt: skip


def add(app, **fields) -> int:
    puzzle = Puzzle(**{"type": "attack", "fen": MATE_IN_ONE, "solver": "white", "solution": ["R@d8"], "rating": 1500,
                       "rd": 100, **fields})
    return app.state.puzzles.store.add(puzzle).id


@needs_engine
def test_solving_rates_once_accepts_any_mate_and_reveals_the_solution_afterwards(tmp_path):
    with client(tmp_path) as c:
        mate_id = add(c.app)
        line_id = add(c.app, fen=STARTING_FEN, solution=["e2e4", "e7e5", "g1f3"], rating=1700)
        assert c.post("/api/players", json={"nickname": "Ann"}).json()["rating"] == 1500
        assert c.post("/api/players", json={"nickname": "<b>"}).status_code == 422

        view = c.get("/api/puzzles/next", params={"player": "Ann", "types": "attack"}).json()
        assert view["id"] in (mate_id, line_id) and "solution" not in view and view["rated"]
        # A link opens a given puzzle (rated like any other).
        linked = c.get(f"/api/puzzles/{line_id}", params={"player": "Ann"}).json()
        assert linked["id"] == line_id and linked["rated"] and "solution" not in linked
        assert c.get("/api/puzzles/999", params={"player": "Ann"}).status_code == 422
        export = c.get(f"/api/puzzles/{mate_id}/export", params={"player": "Ann"}).json()
        assert not export["solution_shown"] and "R@d8" not in export["pgn"] and '[FEN "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"]' in export["pgn"]
        assert export["lichess_analysis_url"] == "https://lichess.org/analysis/crazyhouse/6k1/5ppp/8/8/8/8/5PPP/6K1/R_w_-_-_0_1"

        # Another mating drop than the stored one is just as correct on the last move.
        result = c.post(f"/api/puzzles/{mate_id}/move", json={"player": "Ann", "moves": [], "move": "R@a8"}).json()
        assert result["correct"] and result["done"] and result["rating"]["rated"]
        assert result["rating"]["after"] > 1500 and result["rating"]["puzzle_after"] < 1500
        assert [m["uci"] for m in result["solution"]] == ["R@d8"]
        again = c.post(f"/api/puzzles/{mate_id}/move", json={"player": "Ann", "moves": [], "move": "R@d8"}).json()
        assert not again["rating"]["rated"], "a replay never changes ratings"
        assert "R@d8" in c.get(f"/api/puzzles/{mate_id}/export", params={"player": "Ann"}).json()["pgn"]

        # A three-move line: correct, the reply comes back, then the last move ends it.
        step = c.post(f"/api/puzzles/{line_id}/move", json={"player": "Ann", "moves": [], "move": "e4"}).json()
        assert step["correct"] and not step["done"] and step["reply"]["uci"] == "e7e5"
        hint = c.post(f"/api/puzzles/{line_id}/hint", json={"moves": ["e2e4", "e7e5"]}).json()
        assert hint == {"square": "g1", "drop": None, "text": ""}
        # A move the engine finds about as good is not the answer, but not a failure either: try again.
        as_good = c.post(f"/api/puzzles/{line_id}/move", json={"player": "Ann", "moves": ["e2e4", "e7e5"], "move": "d2d4"}).json()
        assert as_good["alternative"] and not as_good["correct"] and not as_good["done"] and as_good["rating"] is None
        wrong = c.post(f"/api/puzzles/{line_id}/move", json={"player": "Ann", "moves": ["e2e4", "e7e5"], "move": "f1a6"}).json()
        assert not wrong["correct"] and not wrong["alternative"] and wrong["done"]
        assert wrong["rating"]["after"] < wrong["rating"]["before"]
        # Trying again after the failure is allowed but never rated.
        retry = c.post(f"/api/puzzles/{line_id}/move", json={"player": "Ann", "moves": ["e2e4", "e7e5"], "move": "g1f3"}).json()
        assert retry["correct"] and retry["done"] and not retry["rating"]["rated"]
        out_of_step = c.post(f"/api/puzzles/{line_id}/move", json={"player": "Ann", "moves": ["e2e4", "c7c5"], "move": "g1f3"})
        assert out_of_step.status_code == 422
        illegal = c.post(f"/api/puzzles/{mate_id}/move", json={"player": "Ann", "moves": [], "move": "Q@d8"})
        assert illegal.status_code == 422 and illegal.json()["detail"]["error"] == "puzzle"
        assert c.get("/api/puzzles/stats").json() == {"total": 2, "by_type": {"attack": 2, "defense": 0, "tactics": 0, "battle": 0}}


@needs_engine
def test_a_battle_is_scored_against_the_start_and_rated(tmp_path):
    with client(tmp_path) as c:
        battle_id = add(c.app, type="battle", fen=BALANCED, solution=[], battle_plies=2, start_chances=0.0)
        c.post("/api/players", json={"nickname": "Bo"})
        assert c.post(f"/api/puzzles/{battle_id}/move", json={"player": "Bo", "move": "e6e7"}).status_code == 422
        moves: list[str] = []
        board = build_board(BALANCED, [])
        first = c.post(f"/api/puzzles/{battle_id}/battle", json={"player": "Bo", "moves": moves, "move": "a3a4"}).json()
        assert first["verdict"] in ("best", "good", "inaccuracy", "mistake", "blunder") and not first["done"]
        assert first["moves_left"] == 1 and first["reply"] and first["best"]
        moves += [first["played"]["uci"], first["reply"]["uci"]]
        board = build_board(BALANCED, moves)
        answer = next(iter(board.legal_moves)).uci()
        last = c.post(f"/api/puzzles/{battle_id}/battle", json={"player": "Bo", "moves": moves, "move": answer}).json()
        assert last["done"] and last["result"] in (0, 0.5, 1) and last["rating"]["rated"]
        assert -1 <= last["final_chances"] <= 1


@needs_engine
def test_a_hint_in_words_costs_half_a_point_the_piece_to_move_all(tmp_path):
    with client(tmp_path) as c:
        mate_id = add(c.app)
        scores = []
        for level, nickname in enumerate(("No", "Words", "Piece")):
            c.post("/api/players", json={"nickname": nickname})
            result = c.post(f"/api/puzzles/{mate_id}/move",
                            json={"player": nickname, "moves": [], "move": "R@d8", "hint_level": level}).json()
            assert result["correct"] and result["done"]
            scores.append(result["rating"]["score"])
        assert scores == [1.0, 0.5, 0.0]


def test_the_library_reports_restores_and_keeps_each_players_history(tmp_path):
    with client(tmp_path) as c:
        first = add(c.app)
        second = add(c.app, fen="6k1/5ppp/8/8/8/8/5PPP/5K2[R] w - - 0 1", title="底線", ai="codex:gpt-6-luna")
        c.post("/api/players", json={"nickname": "Fay"})
        c.post(f"/api/puzzles/{first}/move", json={"player": "Fay", "moves": [], "move": "R@d8"})
        c.post(f"/api/puzzles/{second}/giveup", json={"player": "Fay"})
        history = c.get("/api/players/Fay/history").json()
        assert [(a["puzzle"]["id"], a["score"]) for a in history["attempts"]] == [(second, 0.0), (first, 1.0)]
        assert history["attempts"][0]["puzzle"]["title"] == "底線" and history["player"]["nickname"] == "Fay"
        assert history["by_type"] == {"attack": {"plays": 2, "score": 0.5}}
        assert c.get("/api/players/Nobody/history").status_code == 422

        assert c.post(f"/api/puzzles/{first}/report", json={"player": "Fay", "reason": "解答有誤"}).status_code == 204
        listed = {p["id"]: p for p in c.get("/api/puzzles").json()}
        assert listed[first]["disabled"] and listed[first]["report"] == "Fay：解答有誤" and listed[first]["source"] == "manual"
        assert listed[second]["ai"] == "codex:gpt-6-luna" and listed[second]["plays"] == 1
        assert c.get("/api/puzzles/stats").json()["total"] == 1, "a reported puzzle is out of the rotation"
        view = c.get(f"/api/puzzles/{first}", params={"player": "Fay"}).json()
        assert view["disabled"] and view["report"] == "Fay：解答有誤", "a link still opens it"
        assert c.post(f"/api/puzzles/{first}/restore").status_code == 204
        assert not c.get(f"/api/puzzles/{first}", params={"player": "Fay"}).json()["disabled"]
        assert c.post("/api/puzzles/999/report", json={"player": "Fay"}).status_code == 422


def test_manual_puzzles_are_checked_by_the_engine(tmp_path):
    with client(tmp_path) as c:
        made = c.post("/api/puzzles", json={"root_fen": MATE_IN_ONE, "type": "attack"})
        assert made.status_code == 200 and made.json()["type"] == "attack" and made.json()["solver_moves"] == 1
        duplicate = c.post("/api/puzzles", json={"root_fen": MATE_IN_ONE, "type": "attack"})
        message = duplicate.json()["detail"]["message"]
        assert duplicate.status_code == 422 and message == f"這個局面已經是一題進攻題（#{made.json()['id']}）"
        refused = c.post("/api/puzzles", json={"moves": ["e2e4"], "type": "attack"})
        assert refused.status_code == 422 and "不適合當進攻題" in refused.json()["detail"]["message"]
        # Saved from a line: the opponent's move that led to the puzzle is kept, to be shown first.
        before = "7k/5ppp/8/8/8/8/5PPP/6K1[R] b - - 0 1"
        from_line = c.post("/api/puzzles", json={"root_fen": before, "moves": ["h8g8"], "type": "attack"}).json()
        assert from_line["before_fen"] == before and from_line["last_move"] == "h8g8"
        assert build_board(before, ["h8g8"]).fen() == from_line["fen"]
        assert made.json()["before_fen"] == "" and made.json()["last_move"] == ""


def wait(c, job):
    for _ in range(600):
        job = c.get(f"/api/puzzle-jobs/{job['job_id']}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.25)
    raise AssertionError("job did not finish")


@needs_engine
def test_mining_a_game_and_making_puzzles_run_in_the_background(tmp_path, monkeypatch):
    node = import_pgn(GAMES[2]["pgn"]).root
    while node.children:
        node = node.children[0]
    with client(tmp_path) as c:
        job = wait(c, c.post("/api/puzzles/mine", json={"moves": node.state.moves, "label": "fixture"}).json())
        assert job["status"] == "done" and job["found"] >= 1 and job["done"] == job["total"]
        assert [m["id"] for m in job["made"]] == list(range(1, job["found"] + 1)), "the stored puzzles, to open"
        store = c.app.state.puzzles.store
        mined = [store.get(i) for i in range(1, job["found"] + 1)]
        assert all(build_board(p.before_fen, [p.last_move]).fen() == p.fen for p in mined), "the move that led here"
        battles = sorted(store.get(i).source["ply"] for i in range(1, job["found"] + 1) if store.get(i).type == "battle")
        assert all(b - a >= 8 for a, b in zip(battles, battles[1:])), "battles from one game are spread out"
        assert c.get("/api/puzzles/stats").json()["total"] == job["found"]
        monkeypatch.setattr(generator, "MAX_PLIES", 24)
        started = c.post("/api/puzzles/generate", json={"count": 1, "types": ["battle", "attack"]}).json()
        again = c.post("/api/puzzles/generate", json={"count": 5, "types": ["attack"]}).json()
        assert again["job_id"] == started["job_id"], "one batch at a time: the running one is returned"
        made = wait(c, started)
        assert made["status"] == "done" and made["kind"] == "generate"

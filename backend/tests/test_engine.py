"""Fairy-Stockfish integration. Uses the real engine binary (scripts/fetch_engine.sh)."""

import asyncio
import json
import os
import signal
import subprocess
import time
from collections import Counter
from dataclasses import replace
from pathlib import Path

import chess
import chess.engine
import pytest
from chess.variant import CrazyhouseBoard
from fastapi.testclient import TestClient

from app.chess_core import STARTING_FEN, position_id, position_state
from app.config import engine_settings
from app.engine import EngineService, normalize_line
from app.main import create_app
from app.pgn_import import import_pgn

SETTINGS = replace(engine_settings(), threads=2, hash_mb=32)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")

WHITE_DROP_MATE = "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"
BLACK_DROP_MATE = "6k1/5ppp/8/8/8/8/5PPP/6K1[r] b - - 0 1"


# --- pure normalization -------------------------------------------------------


def test_normalize_line_converts_to_white_pov():
    board = CrazyhouseBoard("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR[] b KQkq - 0 1")
    info = {
        "score": chess.engine.PovScore(chess.engine.Cp(120), chess.BLACK),
        "pv": [chess.Move.from_uci("e7e5"), chess.Move.from_uci("g1f3")],
        "depth": 12,
    }
    line = normalize_line(board, info, 1)
    assert (line.evaluation, line.mate, line.evaluation_pov) == (-1.2, None, "white")
    assert [m.san for m in line.pv] == ["e5", "Nf3"]


def test_normalize_line_mate_sign_is_white_pov():
    board = CrazyhouseBoard(BLACK_DROP_MATE)
    info = {"score": chess.engine.PovScore(chess.engine.Mate(1), chess.BLACK), "pv": [chess.Move.from_uci("R@e1")]}
    line = normalize_line(board, info, 1)
    assert (line.evaluation, line.mate) == (None, -1)
    assert line.pv[0].model_dump(by_alias=True)["from"] is None and line.pv[0].drop == "R"


def test_normalize_line_truncates_illegal_pv():
    board = CrazyhouseBoard()
    info = {
        "score": chess.engine.PovScore(chess.engine.Cp(10), chess.WHITE),
        "pv": [chess.Move.from_uci("e2e4"), chess.Move.from_uci("e2e4")],
    }
    assert [m.uci for m in normalize_line(board, info, 1).pv] == ["e2e4"]


# --- real engine --------------------------------------------------------------


def run(coro):
    return asyncio.run(coro)


async def with_engine(fn):
    engine = EngineService(SETTINGS)
    try:
        return await fn(engine)
    finally:
        await engine.close()


@needs_engine
def test_startpos_multipv():
    async def go(engine):
        return await engine.analyse(STARTING_FEN, [], position_id(STARTING_FEN, []), 3, 300)

    result = run(with_engine(go))
    assert result.status == "ok" and "Fairy-Stockfish" in result.engine
    assert len(result.lines) == 3
    assert len({line.pv[0].uci for line in result.lines}) == 3, "MultiPV lines start with distinct moves"
    assert result.best_move == result.lines[0].pv[0]
    assert all(line.evaluation_pov == "white" for line in result.lines)
    assert abs(result.lines[0].evaluation) < 3


@needs_engine
@pytest.mark.parametrize(("fen", "mate"), [(WHITE_DROP_MATE, 1), (BLACK_DROP_MATE, -1)])
def test_drop_mate_found_with_white_pov_sign(fen, mate):
    async def go(engine):
        return await engine.analyse(fen, [], position_id(fen, []), 3, 300)

    result = run(with_engine(go))
    assert result.lines[0].mate == mate
    assert result.lines[0].evaluation is None
    assert result.best_move.drop == "R" and result.best_move.san.endswith("#")
    # The engine's move is legal by our rules and really mates.
    after = position_state(fen, [result.best_move.uci])
    assert after.outcome.termination == "checkmate"


@needs_engine
def test_promoted_piece_fen_is_analysed():
    fen = "Q~3k3/8/1n6/8/8/8/8/4K3[R] b - - 0 1"
    result = run(with_engine(lambda e: e.analyse(fen, [], position_id(fen, []), 2, 200)))
    assert result.status == "ok"
    assert result.best_move.uci in position_state(fen, []).legal_moves


@needs_engine
def test_cache_returns_identical_result():
    async def go(engine):
        pid = position_id(STARTING_FEN, ["e2e4"])
        first = await engine.analyse(STARTING_FEN, ["e2e4"], pid, 2, 200)
        second = await engine.analyse(STARTING_FEN, ["e2e4"], pid, 2, 200)
        return first, second

    first, second = run(with_engine(go))
    assert not first.cached and second.cached
    assert first.analysis_id == second.analysis_id


@needs_engine
def test_newer_request_supersedes_running_analysis():
    async def go(engine):
        a = asyncio.create_task(engine.analyse(STARTING_FEN, [], position_id(STARTING_FEN, []), 1, 4000))
        await asyncio.sleep(0.3)
        start = time.monotonic()
        b = await engine.analyse(STARTING_FEN, ["e2e4"], position_id(STARTING_FEN, ["e2e4"]), 1, 300)
        return await a, b, time.monotonic() - start

    a, b, elapsed = run(with_engine(go))
    assert a.status == "cancelled" and a.position_id == position_id(STARTING_FEN, [])
    assert b.status == "ok" and b.position_id == position_id(STARTING_FEN, ["e2e4"])
    assert elapsed < 2.0, "the stale analysis must not run to its full movetime"


@needs_engine
def test_superseded_while_starting_is_stopped_promptly():
    """B arrives after A's search started but before A registered it as running."""

    async def go(engine):
        await engine.analyse(STARTING_FEN, [], position_id(STARTING_FEN, []), 1, 50)  # start the process
        protocol = engine._engine
        real_analysis = protocol.analysis
        later: list[asyncio.Task] = []

        async def analysis_then_newer_request(*args, **kwargs):
            result = await real_analysis(*args, **kwargs)
            if not later:
                later.append(
                    asyncio.create_task(
                        engine.analyse(STARTING_FEN, ["c2c4"], position_id(STARTING_FEN, ["c2c4"]), 1, 200)
                    )
                )
                await asyncio.sleep(0.05)  # let B register itself while A is not yet "running"
            return result

        protocol.analysis = analysis_then_newer_request
        start = time.monotonic()
        a = await engine.analyse(STARTING_FEN, ["d2d4"], position_id(STARTING_FEN, ["d2d4"]), 1, 3000)
        b = await later[0]
        return a, b, time.monotonic() - start

    a, b, elapsed = run(with_engine(go))
    assert a.status == "cancelled" and b.status == "ok"
    assert elapsed < 2.0, "A must be stopped even though B arrived before A was registered"


@needs_engine
def test_engine_process_is_restarted_after_it_dies():
    async def go(engine):
        pid = position_id(STARTING_FEN, [])
        await engine.analyse(STARTING_FEN, [], pid, 1, 50)
        os.kill(engine._engine.transport.get_pid(), signal.SIGKILL)
        await asyncio.sleep(0.3)
        return await engine.analyse(STARTING_FEN, ["e2e4"], position_id(STARTING_FEN, ["e2e4"]), 1, 100)

    assert run(with_engine(go)).status == "ok"


# --- engine board == rules board ---------------------------------------------


class RawEngine:
    """Minimal UCI pipe to ask Fairy-Stockfish what position it actually holds."""

    def __init__(self, path: Path) -> None:
        self.proc = subprocess.Popen([str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.send("uci", "setoption name UCI_Variant value crazyhouse", "isready")
        self.read_until("readyok")

    def send(self, *lines: str) -> None:
        self.proc.stdin.write("\n".join(lines) + "\n")
        self.proc.stdin.flush()

    def read_until(self, prefix: str) -> list[str]:
        lines = []
        while not (line := self.proc.stdout.readline().rstrip("\n")).startswith(prefix):
            lines.append(line)
        return lines

    def describe(self, root_fen: str, moves: list[str]) -> tuple[str, set[str]]:
        position = f"position fen {root_fen}" + (f" moves {' '.join(moves)}" if moves else "")
        self.send(position, "d", "go perft 1")
        out = self.read_until("Nodes searched")
        fen = next(line[5:] for line in out if line.startswith("Fen: "))
        legal = {line.split(":")[0] for line in out if line.endswith(": 1")}  # perft 1: "<uci>: 1"
        return fen, legal

    def close(self) -> None:
        self.send("quit")
        self.proc.wait(timeout=5)


def comparable(fen: str):
    board, side, castling, ep, *_ = fen.split()
    placement, pocket = board[:-1].split("[")
    return placement, Counter(pocket), side, castling


@needs_engine
def test_engine_holds_exactly_our_position_for_every_ply_of_real_games():
    games = json.loads((Path(__file__).parent / "fixtures" / "lichess_finished_games.json").read_text())
    raw = RawEngine(SETTINGS.path)
    checked = 0
    try:
        for game in games:
            node = import_pgn(game["pgn"]).root
            while True:
                state = node.state
                fen, legal = raw.describe(state.root_fen, state.moves)
                assert comparable(fen) == comparable(state.fen), f"ply {state.ply} of {game['id']}"
                assert legal == set(state.legal_moves), f"legal moves differ at ply {state.ply} of {game['id']}"
                checked += 1
                if not node.children:
                    break
                node = node.children[0]
    finally:
        raw.close()
    assert checked > 150


# --- HTTP ---------------------------------------------------------------------


@needs_engine
def test_analyze_endpoint():
    with TestClient(create_app(SETTINGS)) as client:
        body = {"root_fen": WHITE_DROP_MATE, "moves": [], "movetime_ms": 200}
        result = client.post("/api/analyze", json=body).json()
        assert result["status"] == "ok"
        assert result["lines"][0]["mate"] == 1 and result["lines"][0]["evaluation_pov"] == "white"
        assert result["best_move"]["from"] is None

        over = client.post("/api/analyze", json={"root_fen": WHITE_DROP_MATE, "moves": ["R@e8"]}).json()
        assert over["status"] == "game_over" and over["lines"] == []

        stale = client.post("/api/analyze", json={"moves": [], "position_id": "0000000000000000"})
        assert stale.status_code == 409


def test_analyze_without_engine_binary_is_503():
    settings = replace(SETTINGS, path=Path("/nonexistent/fairy-stockfish"))
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/analyze", json={"moves": []})
        assert response.status_code == 503
        assert "fetch_engine.sh" in response.json()["detail"]["message"]


@needs_engine
def test_identical_concurrent_requests_share_one_search():
    async def go(engine):
        pid = position_id(STARTING_FEN, ["g1f3"])
        return await asyncio.gather(
            engine.analyse(STARTING_FEN, ["g1f3"], pid, 2, 300), engine.analyse(STARTING_FEN, ["g1f3"], pid, 2, 300)
        )

    a, b = run(with_engine(go))
    assert a.status == b.status == "ok"
    assert a.analysis_id == b.analysis_id


@needs_engine
def test_insights_use_the_same_engine_result_as_analyze():
    moves = ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6"]
    with TestClient(create_app(SETTINGS)) as client:
        analysis = client.post("/api/analyze", json={"moves": moves, "movetime_ms": 300}).json()
        insights = client.post(
            "/api/insights", json={"moves": moves, "movetime_ms": 300, "analysis_id": analysis["analysis_id"]}
        ).json()
        assert insights["analysis_id"] == analysis["analysis_id"]
        assert insights["position_id"] == analysis["position_id"] == position_id(STARTING_FEN, moves)
        assert [c["facts"]["move"]["uci"] for c in insights["candidates"]] == [l["pv"][0]["uci"] for l in analysis["lines"]]
        assert insights["last_move"]["move"]["san"] == "e6"
        assert insights["position"]["white"]["drop_check_squares"] == {"N": ["d6", "f6"]}
        for candidate in insights["candidates"]:
            assert candidate["evaluation_pov"] == "white"
            assert candidate["pv"][0]["uci"] == candidate["facts"]["move"]["uci"]

        over = client.post("/api/insights", json={"root_fen": WHITE_DROP_MATE, "moves": ["R@e8"]}).json()
        assert over["engine_status"] == "game_over" and over["candidates"] == []
        assert over["last_move"]["is_mate"] and "drop_mate" in over["last_move"]["tags"]


@needs_engine
def test_same_position_other_settings_queue_instead_of_cancelling():
    """A quick look must not cancel a longer search the user asked for on the same position."""

    async def go(engine):
        pid = position_id(STARTING_FEN, ["b1c3"])
        long = asyncio.create_task(engine.analyse(STARTING_FEN, ["b1c3"], pid, 3, 800))
        await asyncio.sleep(0.1)
        quick = await engine.analyse(STARTING_FEN, ["b1c3"], pid, 3, 200)
        return await long, quick

    long, quick = run(with_engine(go))
    assert long.status == "ok" and quick.status == "ok"
    assert long.analysis_id != quick.analysis_id or long.depth >= quick.depth


@needs_engine
def test_root_moves_restrict_the_search_and_are_part_of_the_cache_key():
    async def go(engine):
        pid = position_id(WHITE_DROP_MATE, [])
        best = await engine.analyse(WHITE_DROP_MATE, [], pid, 1, 200)
        forced = await engine.analyse(WHITE_DROP_MATE, [], pid, 1, 200, ("h2h3",))
        return best, forced

    best, forced = run(with_engine(go))
    assert best.lines[0].mate == 1
    assert forced.lines[0].pv[0].uci == "h2h3" and forced.lines[0].mate is None
    assert not forced.cached and forced.analysis_id != best.analysis_id


@needs_engine
def test_insights_include_engine_threat_of_a_null_move():
    with TestClient(create_app(SETTINGS)) as client:
        fen = "6k1/5ppp/8/8/8/8/5PPP/6K1[r] w - - 0 1"  # White to move; Black threatens a drop mate
        insights = client.post("/api/insights", json={"root_fen": fen, "moves": [], "movetime_ms": 200}).json()
        threat = insights["threat"]
        assert threat["side"] == "black" and threat["mate"] == -1 and threat["evaluation_pov"] == "white"
        assert threat["best_move"].startswith("R@") and threat["best_move"].endswith("#")
        # In check there is no null move, so no threat analysis.
        checked = client.post(
            "/api/insights", json={"moves": ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6", "N@d6"], "movetime_ms": 200}
        ).json()
        assert checked["threat"] is None


def test_nnue_is_loaded_when_configured():
    """The configured network is really used for crazyhouse (raw check of FSF's own report)."""
    if SETTINGS.eval_file is None:
        pytest.skip("NNUE not fetched (scripts/fetch_engine.sh)")

    async def go():
        _, engine = await chess.engine.popen_uci(str(SETTINGS.path))
        await engine.configure({"EvalFile": str(SETTINGS.eval_file)})
        strings = []
        with await engine.analysis(CrazyhouseBoard(), chess.engine.Limit(depth=4), info=chess.engine.INFO_ALL) as analysis:
            async for info in analysis:
                strings += [info["string"]] if "string" in info else []
        await engine.quit()
        return strings

    assert any("NNUE evaluation using" in s and SETTINGS.eval_file.name in s for s in run(go()))


@needs_engine
def test_engine_name_records_the_evaluation_mode():
    result = run(with_engine(lambda e: e.analyse(STARTING_FEN, [], position_id(STARTING_FEN, []), 1, 100)))
    assert result.engine.endswith(" NNUE" if SETTINGS.eval_file else " classical")


def test_missing_nnue_file_is_reported():
    settings = replace(SETTINGS, eval_file=Path("/nonexistent/crazyhouse.nnue"))
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/analyze", json={"moves": []})
        assert response.status_code == 503
        assert "NNUE file not found" in response.json()["detail"]["message"]


@needs_engine
def test_protected_search_is_not_cancelled_by_navigation():
    """A user-requested search (protected) runs to its full time even if the UI moves on."""

    async def go(engine):
        await engine.analyse(STARTING_FEN, [], position_id(STARTING_FEN, []), 1, 50)  # start the process
        start = time.monotonic()
        asked = asyncio.create_task(
            engine.analyse(STARTING_FEN, ["d2d4"], position_id(STARTING_FEN, ["d2d4"]), 1, 800, protected=True)
        )
        await asyncio.sleep(0.1)
        browsing = await engine.analyse(STARTING_FEN, ["c2c4"], position_id(STARTING_FEN, ["c2c4"]), 1, 200)
        browsed_at = time.monotonic() - start
        return await asked, browsing, browsed_at

    asked, browsing, browsed_at = run(with_engine(go))
    assert asked.status == "ok" and browsing.status == "ok"
    assert browsed_at >= 0.8, "the browsing search queued behind the protected one instead of stopping it"


@needs_engine
def test_protected_request_joining_a_superseded_search_reruns_it():
    async def go(engine):
        await engine.analyse(STARTING_FEN, [], position_id(STARTING_FEN, []), 1, 50)
        pid = position_id(STARTING_FEN, ["g1f3"])
        background = asyncio.create_task(engine.analyse(STARTING_FEN, ["g1f3"], pid, 1, 1500))
        await asyncio.sleep(0.1)
        asked = asyncio.create_task(engine.analyse(STARTING_FEN, ["g1f3"], pid, 1, 1500, protected=True))
        await asyncio.sleep(0.1)
        # The user navigates: this supersedes the shared (unprotected) search.
        await engine.analyse(STARTING_FEN, ["b1c3"], position_id(STARTING_FEN, ["b1c3"]), 1, 100)
        return await background, await asked

    background, asked = run(with_engine(go))
    assert background.status == "cancelled"
    assert asked.status == "ok" and asked.position_id == position_id(STARTING_FEN, ["g1f3"])


@needs_engine
def test_depth_cap_stops_the_search_early_and_is_part_of_the_cache_key():
    async def go(engine):
        pid = position_id(STARTING_FEN, ["e2e4", "e7e5"])
        start = time.monotonic()
        shallow = await engine.analyse(STARTING_FEN, ["e2e4", "e7e5"], pid, 1, 5000, depth=6)
        elapsed = time.monotonic() - start
        timed = await engine.analyse(STARTING_FEN, ["e2e4", "e7e5"], pid, 1, 300)
        return shallow, elapsed, timed

    shallow, elapsed, timed = run(with_engine(go))
    assert shallow.depth <= 6 and elapsed < 4, "depth 6 ends long before the 5 s movetime"
    assert not timed.cached and timed.depth > 6
    with TestClient(create_app(SETTINGS)) as client:
        body = client.post("/api/analyze", json={"moves": ["d2d4"], "depth": 5, "movetime_ms": 5000}).json()
        assert body["status"] == "ok" and body["depth"] <= 5

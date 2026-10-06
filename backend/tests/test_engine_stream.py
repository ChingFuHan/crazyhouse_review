"""Lichess-like engine settings: streamed search with user-chosen lines, depth, time, threads, hash."""

import asyncio
import json
import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.chess_core import STARTING_FEN, position_id
from app.config import engine_settings
from app.engine import EngineService
from app.llm.provider import FakeProvider
from app.llm.service import ExplainService
from app.main import create_app
from app.models import MAX_THREADS, SearchSettings

SETTINGS = replace(engine_settings(), threads=2, hash_mb=32)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")
LINE = ["e2e4", "e7e5"]
PID = position_id(STARTING_FEN, LINE)


def events(text: str) -> list[tuple[str, dict]]:
    out = []
    for chunk in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in chunk.splitlines())
        out.append((fields["event"], json.loads(fields["data"])))
    return out


def run(coro):
    return asyncio.run(coro)


async def collect(engine, settings, stop_after=None, moves=LINE):
    results = []
    async for result in engine.stream(STARTING_FEN, moves, position_id(STARTING_FEN, moves), settings):
        results.append(result)
        if stop_after is not None and len(results) == stop_after:
            engine.stop(position_id(STARTING_FEN, moves))
    return results


def test_settings_are_validated():
    with pytest.raises(ValueError):
        SearchSettings(threads=MAX_THREADS + 1)
    with pytest.raises(ValueError):
        SearchSettings(hash_mb=8192)
    with pytest.raises(ValueError):
        SearchSettings(multipv=6)
    assert SearchSettings(movetime_ms=None).movetime_ms is None  # infinite


@needs_engine
def test_stream_snapshots_deepen_then_done_and_repeat_is_cached():
    settings = {"multipv": 2, "movetime_ms": 1500, "threads": 2, "hash_mb": 64}
    with TestClient(create_app(SETTINGS)) as client:
        with client.stream("POST", "/api/analyze/stream", json={"moves": LINE, "settings": settings}) as response:
            received = events(response.read().decode())
        kinds = [kind for kind, _ in received]
        assert kinds[-1] == "done" and kinds.count("snapshot") >= 3
        snapshots = [data for kind, data in received if kind == "snapshot"]
        assert all(s["status"] == "running" and len(s["lines"]) == 2 for s in snapshots)
        depths = [s["depth"] for s in snapshots]
        assert depths == sorted(depths) and depths[-1] > depths[0]
        done = received[-1][1]
        assert done["status"] == "ok" and done["position_id"] == PID and done["settings"]["multipv"] == 2
        assert done["lines"][0]["evaluation_pov"] == "white"
        with client.stream("POST", "/api/analyze/stream", json={"moves": LINE, "settings": settings}) as response:
            again = events(response.read().decode())
        assert [k for k, _ in again] == ["done"] and again[0][1]["cached"]
        # The exact displayed result can be fetched back for explanations.
        insights = client.post("/api/insights", json={"moves": LINE, "analysis_id": snapshots[-1]["analysis_id"]}).json()
        assert insights["analysis_id"] == snapshots[-1]["analysis_id"]
        # A shallower snapshot of the same search stays available while it is "running".
        early = client.post("/api/insights", json={"moves": LINE, "analysis_id": snapshots[0]["analysis_id"]}).json()
        assert early["engine_status"] == "running" and early["depth"] == snapshots[0]["depth"]
        assert early["candidates"]


@needs_engine
def test_depth_cap_ends_long_before_the_time_limit():
    engine = EngineService(SETTINGS)

    async def go():
        start = time.monotonic()
        results = await collect(engine, SearchSettings(multipv=1, depth=8, movetime_ms=20_000, threads=2, hash_mb=32))
        await engine.close()
        return results, time.monotonic() - start

    results, elapsed = run(go())
    assert results[-1].status == "ok" and results[-1].depth <= 8 and elapsed < 5


@needs_engine
def test_threads_and_hash_are_applied_per_search():
    engine = EngineService(SETTINGS)

    async def go():
        await collect(engine, SearchSettings(multipv=1, movetime_ms=200, threads=3, hash_mb=128))
        streamed = dict(engine._engine.config)
        await engine.analyse(STARTING_FEN, ["d2d4"], position_id(STARTING_FEN, ["d2d4"]), 1, 100)
        default = dict(engine._engine.config)
        await engine.close()
        return streamed, default

    streamed, default = run(go())
    assert (streamed["Threads"], streamed["Hash"]) == (3, 128)
    assert (default["Threads"], default["Hash"]) == (SETTINGS.threads, SETTINGS.hash_mb)


@needs_engine
def test_infinite_analysis_runs_until_stopped_and_counts_as_complete():
    engine = EngineService(SETTINGS)
    infinite = SearchSettings(multipv=1, movetime_ms=None, threads=2, hash_mb=32)

    async def go():
        start = time.monotonic()
        results = await collect(engine, infinite, stop_after=6)
        elapsed = time.monotonic() - start
        again = await collect(engine, infinite, stop_after=2)
        await engine.close()
        return results, elapsed, again

    results, elapsed, again = run(go())
    assert results[-1].status == "ok" and results[-1].settings.movetime_ms is None
    assert elapsed < 10
    assert engine.find(results[-1].analysis_id) is not None
    # Coming back to the position resumes searching instead of replaying the stopped result.
    assert not again[0].cached and again[0].status == "running" and again[-1].status == "ok"


@needs_engine
def test_another_position_cancels_the_stream_and_it_is_not_cached():
    engine = EngineService(SETTINGS)

    async def go():
        stream = asyncio.create_task(collect(engine, SearchSettings(multipv=1, movetime_ms=None, threads=2, hash_mb=32)))
        await asyncio.sleep(1.0)
        other = await engine.analyse(STARTING_FEN, ["d2d4"], position_id(STARTING_FEN, ["d2d4"]), 1, 200)
        results = await stream
        await engine.close()
        return results, other

    results, other = run(go())
    assert results[-1].status == "cancelled" and other.status == "ok"
    assert not any(key[0] == "stream" for key in engine._cache)


@needs_engine
def test_explanations_without_a_displayed_result_use_the_background_engine():
    with TestClient(create_app(SETTINGS)) as client:
        insights = client.post("/api/insights", json={"moves": LINE}).json()
        assert insights["candidates"]
        app = client.app
        assert app.state.engine._cache == {}, "the interactive engine was not touched"
        assert app.state.review.engine.find(insights["analysis_id"]) is not None
        # ...with the interactive defaults (lines, time), not the review engine's quick 1-line setting.
        searched = [key for key in app.state.review.engine._cache if key[0] == PID]
        assert searched == [(PID, SETTINGS.multipv, SETTINGS.movetime_ms, (), None)]


@needs_engine
def test_questions_about_a_long_analysis_search_candidates_within_the_time_cap():
    settings = replace(SETTINGS, max_movetime_ms=400)
    long_search = {"multipv": 2, "depth": 8, "movetime_ms": 60_000, "threads": 2, "hash_mb": 32}
    with TestClient(create_app(settings, ExplainService(FakeProvider()))) as client:
        with client.stream("POST", "/api/analyze/stream", json={"moves": LINE, "settings": long_search}) as response:
            done = events(response.read().decode())[-1][1]
        assert done["status"] == "ok" and done["movetime_ms"] == 60_000
        played = {line["pv"][0]["uci"] for line in done["lines"]}
        candidate = next(uci for uci in ("a2a3", "h2h3", "a2a4", "h2h4") if uci not in played)
        start = time.monotonic()
        answer = client.post(
            "/api/explain",
            json={"moves": LINE, "question": f"如果我改走 {candidate} 呢？", "analysis_id": done["analysis_id"]},
        ).json()
        assert time.monotonic() - start < 15
        assert answer["analysis_id"] == done["analysis_id"]
        assert [c["source"] for c in answer["checked_moves"]] == ["engine_after_move"]
        after = position_id(STARTING_FEN, [*LINE, candidate])
        assert (after, 2, 400, (), None) in client.app.state.review.engine._cache


@needs_engine
def test_a_stream_cancelled_while_the_search_starts_leaves_no_search_running():
    """A client that leaves while the search is starting (python-chess still sends `go` after the
    cancellation) must not leave an infinite search occupying the engine."""
    engine = EngineService(SETTINGS)
    infinite = SearchSettings(multipv=1, movetime_ms=None, threads=2, hash_mb=32)

    async def go():
        uci = await engine._ensure_started()
        original, starting = uci.analysis, asyncio.Event()

        async def analysis(*args, **kwargs):
            starting.set()
            return await original(*args, **kwargs)

        uci.analysis = analysis

        async def consume():
            async for _ in engine.stream(STARTING_FEN, LINE, PID, infinite):
                pass

        task = asyncio.create_task(consume())
        await starting.wait()  # the stream is now waiting for the engine to start searching
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        uci.analysis = original
        start = time.monotonic()
        other = position_id(STARTING_FEN, ["d2d4"])
        result = await asyncio.wait_for(engine.analyse(STARTING_FEN, ["d2d4"], other, 1, 200), timeout=10)
        elapsed = time.monotonic() - start
        await engine.close()
        return result, elapsed

    result, elapsed = run(go())
    assert result.status == "ok" and result.lines
    assert elapsed < 3, "the next search waited for an orphaned one"

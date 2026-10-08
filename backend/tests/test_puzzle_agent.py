"""Making puzzles with an agent: picking and writing (curate) and designing positions (design)."""

import asyncio
from dataclasses import dataclass, field, replace

import pytest
from fastapi.testclient import TestClient

from app.config import engine_settings, puzzle_engine_settings
from app.engine import EngineService
from app.llm.provider import FakeProvider, LLMResult
from app.llm.service import ExplainService
from app.main import create_app
from app.puzzles.agent import curate, design, extract_json, gives_away
from app.puzzles.miner import Miner
from app.puzzles.models import Puzzle

SETTINGS = replace(engine_settings(), threads=2, hash_mb=32)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")
MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"
DEFENSE = "rnbq3r/ppp1kpNp/4pp2/3p4/3Pn3/P1b2N2/2PBPPPP/1R1QKB1R[p] w K - 0 11"


@dataclass
class Scripted:
    """An agent that answers from a script and records what it was asked."""

    answers: list[str]
    name: str = "scripted:agent"
    calls: list[list[dict]] = field(default_factory=list)

    async def stream(self, system, messages):
        self.calls.append(list(messages))  # the caller keeps appending to its list
        text = self.answers[min(len(self.calls), len(self.answers)) - 1]
        yield LLMResult(text=text, model=self.name, stop_reason="end_turn")


def test_json_is_found_bare_fenced_or_wrapped_in_words():
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('好的：\n```json\n{"a": [1, 2]}\n```\n以上') == {"a": [1, 2]}
    assert extract_json('設計如下 {"fen": "x"} 完畢') == {"fen": "x"}
    assert extract_json("沒有 JSON") is None and extract_json("[1, 2]") is None


def test_a_hint_or_title_that_names_the_answer_gives_it_away():
    puzzle = Puzzle(type="attack", fen=MATE_IN_ONE, solver="white", solution=["R@d8"])
    assert gives_away("打入 R@d8 就殺", puzzle) and gives_away("注意 d8 這一格", puzzle)
    assert not gives_away("黑王缺少逃生格，底線很空", puzzle)


@needs_engine
def test_the_agent_picks_and_writes_but_cannot_invent_or_give_away():
    async def run():
        miner = Miner(EngineService(replace(puzzle_engine_settings(), threads=2)), 300)
        candidates = [
            # The agent sees them hardest first: id 0 is the mate, id 1 the defense.
            Puzzle(type="defense", fen=DEFENSE, solver="white", solution=["d2c3"], hardness=0.1),
            Puzzle(type="attack", fen=MATE_IN_ONE, solver="white", solution=["R@d8"], hardness=0.4),
        ]
        agent = Scripted(['{"picks": ['
                          '{"id": 7, "title": "不存在"},'
                          '{"id": 0, "title": "底線的弱點", "hint": "R@d8 直接將死", "explanation": "R@d8 將殺；Qxf7# 不存在。", "difficulty": 2},'
                          '{"id": 0, "title": "重複"},'
                          '{"id": 1, "title": "先處理 c3", "hint": "對方的象正在吃子", "explanation": "Bxc3 收回棋子。"}]}'])
        notes: list[str] = []
        picked = await curate(agent, miner, candidates, 2, notes.append)
        fallback = await curate(Scripted(["這不是 JSON"]), miner, candidates, 1, notes.append)
        await miner.engine.close()
        return agent, picked, fallback, notes

    agent, picked, fallback, notes = asyncio.run(run())
    assert "<puzzle_candidates>" in agent.calls[0][0]["content"]
    assert [p.fen for p in picked] == [MATE_IN_ONE, DEFENSE], "unknown ids and repeats are ignored"
    mate = picked[0]
    assert mate.title == "底線的弱點" and mate.hint == "", "a hint naming the answer is dropped"
    assert mate.ai == "scripted:agent" and [w.quote for w in mate.ai_warnings] == ["Qxf7#"]
    assert picked[1].hint == "對方的象正在吃子"
    assert picked[1].title == "", "a title naming the answer's square is dropped"
    assert fallback[0].fen == MATE_IN_ONE and fallback[0].title == "", "unusable answer: hardest by the engine"
    assert any("無法使用" in n for n in notes)


@needs_engine
def test_the_agent_designs_until_the_engine_accepts_and_hears_why_not():
    design_answers = [
        "我想想看",
        '{"fen": "k7/8/8/8/8/8/8/KK6[] w - - 0 1", "title": "兩個王"}',
        '{"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1", "title": "開局"}',
        # The idea is wrong (no knight is needed): it is never shown.
        f'{{"fen": "{MATE_IN_ONE}", "title": "底線", "hint": "黑王的出路在哪？", "idea": "先打入馬引離，再車殺。"}}',
    ]

    async def run():
        miner = Miner(EngineService(replace(puzzle_engine_settings(), threads=2)), 300)
        agent = Scripted([*design_answers, '{"picks": [{"id": 0, "title": "被困的王", "hint": "黑王的兵擋住了自己",'
                                           ' "explanation": "車打入底線將殺：黑王被自己的兵困住。"}]}'])
        notes: list[str] = []
        puzzle = await design(agent, miner, "attack", "打入將殺", MATE_IN_ONE, notes.append)
        # When the agent cannot write from the engine's solution, the design's title and hint stay.
        silent = Scripted([design_answers[3], "寫不出來"])
        kept = await design(silent, miner, "attack", "", MATE_IN_ONE, [].append)
        await miner.engine.close()
        return agent, puzzle, kept, notes

    agent, puzzle, kept, notes = asyncio.run(run())
    assert puzzle is not None and puzzle.type == "attack" and puzzle.solution[0].startswith("R@")
    assert puzzle.source["kind"] == "design" and puzzle.ai == "scripted:agent"
    assert len(notes) == 5 and "沒有 JSON" in notes[0] and "局面不合法：too_many_kings" in notes[1] and "沒有唯一解" in notes[2]
    assert notes[3].endswith("合格") and "依 engine 的解答" in notes[4]
    # Each retry tells the agent exactly why its last position failed.
    assert "不合格：局面不合法" in agent.calls[2][-1]["content"] and "沒有唯一解" in agent.calls[3][-1]["content"]
    # The texts are written from the engine's solution, not from the idea given before it was known.
    assert "<puzzle_candidates>" in agent.calls[4][-1]["content"] and "R@" in agent.calls[4][-1]["content"]
    assert puzzle.title == "被困的王" and puzzle.hint == "黑王的兵擋住了自己" and "困住" in puzzle.explanation
    assert "引離" not in puzzle.explanation and not puzzle.ai_warnings
    assert kept is not None and kept.title == "底線" and kept.hint == "黑王的出路在哪？" and kept.explanation == ""


def test_designing_needs_an_agent_and_a_valid_choice(tmp_path):
    with TestClient(create_app(SETTINGS, ExplainService(None, "LLM 未設定"), puzzle_db=tmp_path / "p.db")) as c:
        refused = c.post("/api/puzzles/generate", json={"mode": "design", "type": "attack", "count": 1})
        assert refused.status_code == 422 and "沒有可用的 AI" in refused.json()["detail"]["message"]
        bad = c.post("/api/puzzles/generate", json={"mode": "curate", "llm": {"provider": "codex", "model": "--x"}})
        assert bad.status_code == 422
    with TestClient(create_app(SETTINGS, ExplainService(FakeProvider()), puzzle_db=tmp_path / "q.db")) as c:
        job = c.post("/api/puzzles/generate", json={"mode": "curate", "count": 1, "types": ["attack"]}).json()
        assert job["ai"] == "fake" and job["status"] == "running"

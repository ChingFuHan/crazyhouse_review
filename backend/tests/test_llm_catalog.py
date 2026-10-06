"""Choosing the AI: catalogs read from the CLIs (fake executables printing recorded output), choices
checked against them, and the chosen CLI answering through the normal explanation pipeline."""

import asyncio
import json
import sys
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import engine_settings
from app.llm.catalog import ChoiceError, ProviderPool, parse_agy_models, parse_claude_models, parse_codex_models, parse_help_choices
from app.llm.provider import CodexProvider, FakeProvider
from app.llm.service import ExplainService
from app.main import create_app
from app.models import LlmChoice

FIXTURES = Path(__file__).parent / "fixtures"
SETTINGS = replace(engine_settings(), threads=2, hash_mb=32, movetime_ms=300)
needs_engine = pytest.mark.skipif(not SETTINGS.path.exists(), reason="run scripts/fetch_engine.sh")

AGY_MODELS = "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\n"
AGY_HELP = "Flags:\n  --effort                        Reasoning effort for the current CLI session (low|medium|high|xhigh|max)\n  --mode    Set the agent execution mode (accept-edits, plan)\n"
CLAUDE_HELP = """Options:
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --environment <environment_id>        Create a new cloud session that runs on
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name.
  -n, --name <name>                     Set a display name for this session
"""
CODEX_MODELS = {"models": [
    {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1-Sol", "visibility": "list", "default_reasoning_level": "low",
     "supported_reasoning_levels": [{"effort": "low"}, {"effort": "high"}, {"effort": "ultra"}]},
    {"slug": "gpt-6-luna", "display_name": "GPT-6-Luna", "visibility": "list", "default_reasoning_level": "medium",
     "supported_reasoning_levels": [{"effort": "low"}, {"effort": "medium"}]},
    {"slug": "gpt-reserve", "display_name": "hidden", "visibility": "hide", "supported_reasoning_levels": []},
]}


def test_parsers_read_what_the_clis_print():
    assert [(m.id, m.label) for m in parse_agy_models(AGY_MODELS)] == [
        ("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"), ("gemini-3.1-pro-low", "Gemini 3.1 Pro (Low)"),
    ]
    assert parse_help_choices(AGY_HELP, "--effort") == ["low", "medium", "high", "xhigh", "max"]
    assert parse_help_choices(AGY_HELP, "--mode") == ["accept-edits", "plan"]
    assert parse_help_choices(CLAUDE_HELP, "--effort") == ["low", "medium", "high", "xhigh", "max"]  # wrapped line
    assert [m.id for m in parse_claude_models(CLAUDE_HELP)] == ["fable", "opus", "sonnet"]
    codex = parse_codex_models(json.dumps(CODEX_MODELS))
    assert [m.id for m in codex] == ["gpt-6.1-sol", "gpt-6-luna"], "hidden models are left out"
    assert codex[0].efforts == ["low", "high", "ultra"] and codex[0].default_effort == "low"
    assert parse_help_choices("no such option here", "--effort") == []


FAKE_CLI = r'''
import json, os, sys
name = os.environ["FAKE_CLI_NAME"]
state = json.load(open(os.environ["FAKE_CLI_STATE"]))
args = sys.argv[1:]
if name == "agy" and args == ["models"]:
    print(state["agy_models"]); sys.exit(0)
if name == "agy" and args == ["--help"]:
    sys.stderr.write(state["agy_help"]); sys.exit(0)  # the real agy prints its help to stderr
if name == "claude" and args == ["--help"]:
    print(state["claude_help"]); sys.exit(0)
if name == "codex" and args == ["debug", "models"]:
    print(json.dumps(state["codex_models"])); sys.exit(0)
if name == "codex" and args[:1] == ["exec"]:
    sys.stdin.read()
    model = args[args.index("-m") + 1] if "-m" in args else "default"
    print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": f"codex {model} 的回答"}}))
    print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 2}}))
    sys.exit(0)
sys.stderr.write("unexpected call: " + " ".join(args) + "\n"); sys.exit(2)
'''


@pytest.fixture
def fake_clis(tmp_path, monkeypatch):
    script = tmp_path / "fake_cli.py"
    script.write_text(FAKE_CLI)
    state = tmp_path / "state.json"
    paths = {}
    for name in ("agy", "codex", "claude"):
        exe = tmp_path / name
        exe.write_text(f"#!/bin/sh\nFAKE_CLI_NAME={name} exec {sys.executable} {script} \"$@\"\n")
        exe.chmod(0o755)
        paths[name] = str(exe)

    def write(**overrides):
        data = {"agy_models": AGY_MODELS, "agy_help": AGY_HELP, "claude_help": CLAUDE_HELP, "codex_models": CODEX_MODELS}
        state.write_text(json.dumps({**data, **overrides}))

    write()
    monkeypatch.setenv("FAKE_CLI_STATE", str(state))
    return paths, write


def test_pool_lists_every_cli_and_validates_choices(fake_clis):
    paths, write = fake_clis
    pool = ProviderPool({**paths, "claude": "/nonexistent/claude"})

    async def run():
        options = {o.id: o for o in await pool.catalog()}
        assert options["agy"].available and [m.id for m in options["agy"].models][0] == "gemini-3.8-flash-high"
        assert options["agy"].efforts == ["low", "medium", "high", "xhigh", "max"]
        assert options["codex"].available and options["codex"].efforts == ["low", "high", "ultra", "medium"]
        assert not options["claude"].available and "找不到" in options["claude"].reason

        provider = await pool.provider(LlmChoice(provider="codex", model="gpt-6.1-sol", effort="ultra"))
        assert isinstance(provider, CodexProvider) and provider.name == "codex:gpt-6.1-sol (ultra)"
        assert await pool.provider(LlmChoice(provider="codex", model="gpt-6.1-sol", effort="ultra")) is provider
        await pool.provider(LlmChoice(provider="codex"))  # the CLI's own default model and effort
        with pytest.raises(ChoiceError, match="不支援 effort「medium」"):
            await pool.provider(LlmChoice(provider="codex", model="gpt-6.1-sol", effort="medium"))  # per-model levels
        with pytest.raises(ChoiceError, match="無法使用"):
            await pool.provider(LlmChoice(provider="claude"))

        # A CLI update replaces a model: one the cached catalog does not know makes the pool read the
        # CLI again, so the new model is accepted at once and the dropped one is refused from then on.
        write(agy_models="gemini-4-flash\tGemini 4 Flash\n")
        assert (await pool.provider(LlmChoice(provider="agy", model="gemini-4-flash"))).name == "agy:gemini-4-flash"
        with pytest.raises(ChoiceError, match="已不提供 model「gemini-3.8-flash-high」"):
            await pool.provider(LlmChoice(provider="agy", model="gemini-3.8-flash-high"))
        pool.close()

    asyncio.run(run())


def test_choices_cannot_smuggle_flags():
    with pytest.raises(ValueError):
        LlmChoice(provider="codex", model="--dangerously-bypass")
    with pytest.raises(ValueError):
        LlmChoice(provider="agy", effort="high; rm")
    with pytest.raises(ValueError):
        LlmChoice(provider="gemini")


@needs_engine
def test_the_chosen_cli_answers_and_bad_choices_are_rejected_before_any_work(fake_clis, monkeypatch):
    paths, _ = fake_clis
    monkeypatch.setenv("AGY_PATH", paths["agy"])
    monkeypatch.setenv("CODEX_PATH", paths["codex"])
    monkeypatch.setenv("CLAUDE_PATH", paths["claude"])
    fake = FakeProvider()
    with TestClient(create_app(SETTINGS, ExplainService(fake))) as client:
        catalog = client.get("/api/llm/catalog", params={"refresh": "true"}).json()
        assert catalog["default"] == "fake" and {p["id"] for p in catalog["providers"]} == {"agy", "codex", "claude"}
        moves = ["e2e4", "e7e5"]
        choice = {"provider": "codex", "model": "gpt-6-luna", "effort": "medium"}
        answer = client.post("/api/explain", json={"moves": moves, "llm": choice}).json()
        assert answer["model"] == "codex:gpt-6-luna (medium)" and answer["text"] == "codex gpt-6-luna 的回答"
        assert fake.calls == [], "the server default was not used"
        default = client.post("/api/explain", json={"moves": moves}).json()
        assert default["model"] == "fake"
        refused = client.post("/api/explain", json={"moves": moves, "llm": {"provider": "codex", "model": "gpt-9"}})
        assert refused.status_code == 422 and refused.json()["detail"]["error"] == "llm_choice"
        scan = client.post("/api/explain/game/stream", json={"moves": moves, "side": "white", "llm": {"provider": "agy", "effort": "turbo"}})
        assert scan.status_code == 422 and "turbo" in scan.json()["detail"]["message"]

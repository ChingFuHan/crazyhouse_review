"""AgyProvider against a fake `agy` executable that replays recorded output (no quota spent)."""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import pytest

from app.config import llm_settings
from app.llm.provider import AgyProvider, LLMError, LLMResult, LLMUnavailable, agy_prompt, complete, parse_agy_event

FIXTURES = Path(__file__).parent / "fixtures"

FAKE_AGY = r'''
import json, os, sys, time
mode = os.environ["FAKE_AGY_MODE"]
with open(os.environ["FAKE_AGY_ARGS"], "w") as f:
    json.dump({"argv": sys.argv[1:], "cwd": os.getcwd()}, f)
if mode == "ok":
    for line in open(os.environ["FAKE_AGY_FIXTURE"]):
        sys.stdout.write(line); sys.stdout.flush(); time.sleep(0.02)
elif mode == "error":
    sys.stdout.write(open(os.environ["FAKE_AGY_FIXTURE"]).read()); sys.exit(1)
elif mode == "login":
    sys.stderr.write("error: not logged in, run agy to sign in\n"); sys.exit(1)
elif mode == "hang":
    print(json.dumps({"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "..."}}), flush=True)
    with open(os.environ["FAKE_AGY_ARGS"] + ".pid", "w") as f:
        f.write(str(os.getpid()))
    time.sleep(60)
'''


@pytest.fixture
def fake_agy(tmp_path, monkeypatch):
    script = tmp_path / "fake_agy.py"
    script.write_text(FAKE_AGY)
    exe = tmp_path / "agy"
    exe.write_text(f"#!/bin/sh\nexec {sys.executable} {script} \"$@\"\n")
    exe.chmod(0o755)
    args = tmp_path / "args.json"
    monkeypatch.setenv("FAKE_AGY_ARGS", str(args))

    def run(mode, fixture="agy_stream_ok.ndjson", timeout_s=30):
        monkeypatch.setenv("FAKE_AGY_MODE", mode)
        monkeypatch.setenv("FAKE_AGY_FIXTURE", str(FIXTURES / fixture))
        return AgyProvider("gemini-3.8-flash-high", str(exe), timeout_s), args

    return run


MESSAGES = [
    {"role": "user", "content": "先前的問題"},
    {"role": "assistant", "content": "先前的回答"},
    {"role": "user", "content": "<position_context>\n{}\n</position_context>\n\n現在呢？"},
]


def test_parse_recorded_events():
    lines = (FIXTURES / "agy_stream_ok.ndjson").read_text().splitlines()
    parsed = [p for line in lines if (p := parse_agy_event(line))]
    assert [k for k, _ in parsed] == ["delta", "delta", "result"]
    assert parsed[-1][1]["status"] == "SUCCESS" and parsed[-1][1]["response"] == "好的\n"
    assert parse_agy_event("not json") is None


def test_prompt_puts_rules_first_then_history_then_question():
    prompt = agy_prompt("SYSTEM RULES", MESSAGES)
    assert prompt.startswith("SYSTEM RULES")
    assert prompt.index("不要使用任何工具") < prompt.index("[使用者] 先前的問題") < prompt.index("[助手] 先前的回答")
    assert prompt.rstrip().endswith("現在呢？") and prompt.count("<position_context>") == 1


def test_streams_deltas_then_result_with_safe_flags(fake_agy):
    provider, args = fake_agy("ok")

    async def collect():
        return [item async for item in provider.stream("SYSTEM", MESSAGES)]

    items = asyncio.run(collect())
    assert items[:-1] == ["好的", "\n"] and isinstance(items[-1], LLMResult)
    assert items[-1].text == "好的" and items[-1].model == "agy:gemini-3.8-flash-high"
    recorded = json.loads(args.read_text())
    argv = recorded["argv"]
    assert argv[argv.index("--model") + 1] == "gemini-3.8-flash-high"
    assert argv[argv.index("--output-format") + 1] == "stream-json"
    assert argv[argv.index("--mode") + 1] == "plan" and "--sandbox" in argv
    assert argv[argv.index("-p") + 1].startswith("SYSTEM")
    assert os.listdir(recorded["cwd"]) == [], "runs in a private empty directory"


def test_error_result_becomes_llm_error(fake_agy):
    provider, _ = fake_agy("error", "agy_stream_error.ndjson")
    with pytest.raises(LLMError, match="invalid model selection"):
        asyncio.run(complete(provider, "S", MESSAGES))


def test_not_logged_in_is_unavailable(fake_agy):
    provider, _ = fake_agy("login")
    with pytest.raises(LLMUnavailable, match="尚未登入"):
        asyncio.run(complete(provider, "S", MESSAGES))


def test_timeout_kills_the_run(fake_agy, monkeypatch):
    monkeypatch.setattr("app.llm.provider.AGY_GRACE_S", 0)
    provider, args = fake_agy("hang", timeout_s=1)
    start = time.monotonic()
    with pytest.raises(LLMError, match="逾時"):
        asyncio.run(complete(provider, "S", MESSAGES))
    assert time.monotonic() - start < 5
    pid = int(Path(str(args) + ".pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_closing_the_stream_early_kills_the_run(fake_agy):
    provider, args = fake_agy("hang")

    async def first_delta_then_close():
        stream = provider.stream("S", MESSAGES)
        first = await anext(stream)
        await stream.aclose()  # e.g. the browser disconnected
        return first

    assert asyncio.run(first_delta_then_close()) == "..."
    pid = int(Path(str(args) + ".pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_missing_binary_is_unavailable():
    with pytest.raises(LLMUnavailable, match="找不到 agy"):
        AgyProvider("gemini-3.8-flash-high", "/nonexistent/agy")


def test_auto_provider_selection(monkeypatch, tmp_path):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert llm_settings().provider == "anthropic" and llm_settings().model == "claude-opus-5-5"
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    exe = tmp_path / "agy"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    monkeypatch.setenv("AGY_PATH", str(exe))
    settings = llm_settings()
    assert (settings.provider, settings.model) == ("agy", "gemini-3.8-flash-high")
    monkeypatch.setenv("AGY_PATH", "/nonexistent/agy")
    assert llm_settings().provider == "none"

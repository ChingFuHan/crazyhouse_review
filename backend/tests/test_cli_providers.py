"""CLI providers (agy, codex, claude) against a fake executable that replays recorded output (no quota spent)."""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import pytest

from app.config import llm_settings
from app.llm.provider import (
    AgyProvider,
    ClaudeCliProvider,
    CodexProvider,
    LLMError,
    LLMResult,
    LLMUnavailable,
    cli_prompt,
    complete,
    parse_agy_event,
)

FIXTURES = Path(__file__).parent / "fixtures"

FAKE_AGY = r'''
import json, os, sys, time
mode = os.environ["FAKE_AGY_MODE"]
stdin = sys.stdin.read()
with open(os.environ["FAKE_AGY_ARGS"], "w") as f:
    json.dump({"argv": sys.argv[1:], "cwd": os.getcwd(), "stdin": stdin}, f)
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

    providers: list[AgyProvider] = []

    def run(mode, fixture="agy_stream_ok.ndjson", timeout_s=30, cls=AgyProvider, model="gemini-3.8-flash-high", effort=None):
        monkeypatch.setenv("FAKE_AGY_MODE", mode)
        monkeypatch.setenv("FAKE_AGY_FIXTURE", str(FIXTURES / fixture))
        providers.append(cls(str(exe), model, effort, timeout_s))
        return providers[-1], args

    yield run
    for provider in providers:
        provider.close()


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
    prompt = cli_prompt("SYSTEM RULES", MESSAGES)
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
    provider.close()
    assert not os.path.exists(recorded["cwd"]), "the directory is removed on close"


def test_error_result_becomes_llm_error(fake_agy):
    provider, _ = fake_agy("error", "agy_stream_error.ndjson")
    with pytest.raises(LLMError, match="invalid model selection"):
        asyncio.run(complete(provider, "S", MESSAGES))


def test_not_logged_in_is_unavailable(fake_agy):
    provider, _ = fake_agy("login")
    with pytest.raises(LLMUnavailable, match="尚未登入"):
        asyncio.run(complete(provider, "S", MESSAGES))


def test_timeout_kills_the_run(fake_agy, monkeypatch):
    monkeypatch.setattr("app.llm.provider.CLI_GRACE_S", 0)
    provider, args = fake_agy("hang", timeout_s=1)
    start = time.monotonic()
    with pytest.raises(LLMError, match=r"逾時：agy:gemini-3\.8-flash-high 超過 1 秒.*降低 effort"):
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
        AgyProvider("/nonexistent/agy", "gemini-3.8-flash-high")


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


def collect(provider):
    async def run():
        return [item async for item in provider.stream("SYSTEM", MESSAGES)]

    return asyncio.run(run())


def test_agy_passes_the_chosen_effort(fake_agy):
    provider, args = fake_agy("ok", effort="max")
    assert isinstance(collect(provider)[-1], LLMResult)
    argv = json.loads(args.read_text())["argv"]
    assert argv[argv.index("--effort") + 1] == "max" and provider.name == "agy:gemini-3.8-flash-high (max)"


def test_codex_runs_read_only_with_the_prompt_on_stdin(fake_agy):
    provider, args = fake_agy("ok", "codex_stream_ok.jsonl", cls=CodexProvider, model="gpt-6.1-sol", effort="low")
    items = collect(provider)
    assert items[:-1] == ["你好"] and items[-1].text == "你好" and items[-1].model == "codex:gpt-6.1-sol (low)"
    assert items[-1].input_tokens and items[-1].output_tokens == 5
    recorded = json.loads(args.read_text())
    argv = recorded["argv"]
    assert argv[0] == "exec" and argv[-1] == "-" and "--json" in argv and "--ephemeral" in argv
    assert argv[argv.index("-s") + 1] == "read-only" and argv[argv.index("-C") + 1] == recorded["cwd"]
    assert argv[argv.index("-m") + 1] == "gpt-6.1-sol"
    assert argv[argv.index("-c") + 1] == 'model_reasoning_effort="low"'
    # Clean run: none of the user's own codex config, rules, hooks, plugins or tools.
    assert "--ignore-user-config" in argv and "--ignore-rules" in argv
    disabled = {argv[i + 1] for i, arg in enumerate(argv) if arg == "--disable"}
    assert {"hooks", "plugins", "apps", "shell_tool", "shell_snapshot"} <= disabled
    assert recorded["stdin"].startswith("SYSTEM") and recorded["stdin"].rstrip().endswith("現在呢？")


def test_codex_default_model_and_effort_add_no_flags(fake_agy):
    provider, args = fake_agy("ok", "codex_stream_ok.jsonl", cls=CodexProvider, model=None)
    collect(provider)
    argv = json.loads(args.read_text())["argv"]
    assert "-m" not in argv and "-c" not in argv and provider.name == "codex:default"


def test_codex_failed_turn_is_an_error(fake_agy, tmp_path):
    fixture = tmp_path / "codex_failed.jsonl"
    fixture.write_text('{"type":"turn.started"}\n{"type":"turn.failed","error":{"message":"model is not supported"}}\n')
    provider, _ = fake_agy("ok", str(fixture), cls=CodexProvider, model="old-model")
    with pytest.raises(LLMError, match="model is not supported"):
        collect(provider)


def test_claude_streams_with_our_system_prompt_and_no_tools(fake_agy):
    provider, args = fake_agy("ok", "claude_stream_ok.jsonl", cls=ClaudeCliProvider, model="sonnet", effort="low")
    items = collect(provider)
    assert items[:-1] == ["你好"] and items[-1].text == "你好" and items[-1].model == "claude:sonnet (low)"
    recorded = json.loads(args.read_text())
    argv = recorded["argv"]
    assert argv[0] == "-p" and argv[argv.index("--system-prompt") + 1] == "SYSTEM"
    assert argv[argv.index("--tools") + 1] == "" and argv[argv.index("--setting-sources") + 1] == ""
    assert "--no-session-persistence" in argv and "--strict-mcp-config" in argv and "--bare" not in argv
    assert argv[argv.index("--model") + 1] == "sonnet" and argv[argv.index("--effort") + 1] == "low"
    # The rules travel as the system prompt, so the message itself starts with the output rule.
    assert recorded["stdin"].startswith("# 輸出規則") and "SYSTEM" not in recorded["stdin"]


def test_claude_error_result_and_login_failure(fake_agy, tmp_path):
    fixture = tmp_path / "claude_error.jsonl"
    fixture.write_text('{"type":"result","subtype":"success","is_error":true,"result":"Invalid model name"}\n')
    provider, _ = fake_agy("ok", str(fixture), cls=ClaudeCliProvider, model="nope")
    with pytest.raises(LLMError, match="Invalid model name"):
        collect(provider)
    provider, _ = fake_agy("login", cls=ClaudeCliProvider, model=None)
    with pytest.raises(LLMUnavailable, match="claude 尚未登入"):
        collect(provider)

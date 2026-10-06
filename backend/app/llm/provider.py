"""Thin LLM provider boundary: upper layers never import a vendor SDK directly."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

import anthropic

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMUnavailable(RuntimeError):
    """No usable LLM is configured (missing or rejected credentials)."""


class LLMError(RuntimeError):
    """The LLM call failed; ``message`` is safe to show to the user."""


@dataclass(frozen=True)
class LLMResult:
    text: str
    model: str
    stop_reason: str | None
    refused: bool = False
    request_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(Protocol):
    name: str

    def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str | LLMResult]:
        """Yield text deltas, then exactly one final LLMResult."""
        ...


async def complete(provider: LLMProvider, system: str, messages: list[dict]) -> LLMResult:
    """Drain a provider stream into its final result."""
    result: LLMResult | None = None
    async for item in provider.stream(system, messages):
        if isinstance(item, LLMResult):
            result = item
    assert result is not None, "provider stream ended without a result"
    return result


class AnthropicProvider:
    """Claude via the official SDK. Credentials come from the environment (.env), never from code."""

    def __init__(self, model: str, effort: str, max_tokens: int, client: anthropic.AsyncAnthropic | None = None) -> None:
        if client is None and not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            raise LLMUnavailable("LLM 未設定：請在 .env 設定 ANTHROPIC_API_KEY")
        self.name = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.client = client or anthropic.AsyncAnthropic()

    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str | LLMResult]:
        try:
            async with self.client.beta.messages.stream(
                model=self.name,
                max_tokens=self.max_tokens,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                output_config={"effort": self.effort},
                # On a safety decline, retry server-side on Anthropic's recommended model. A mid-stream
                # fallback continues the same stream after a `fallback` block, so the text stays coherent.
                betas=[FALLBACK_BETA],
                fallbacks="default",
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                message = await stream.get_final_message()
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
            raise LLMUnavailable("LLM 憑證無效或沒有權限（請檢查 .env 的 ANTHROPIC_API_KEY）") from error
        except anthropic.RateLimitError as error:
            raise LLMError("LLM 請求過於頻繁，請稍後再試") from error
        except anthropic.APIStatusError as error:
            log.error("LLM API error %s (request %s)", error.status_code, error.request_id)
            raise LLMError(f"LLM 服務錯誤（HTTP {error.status_code}）") from error
        except anthropic.APIConnectionError as error:
            raise LLMError("無法連線到 LLM 服務") from error

        if message.stop_reason == "refusal":
            # The whole chain declined: any streamed partial must be discarded by the caller.
            yield LLMResult("", message.model, "refusal", refused=True, request_id=message._request_id)
            return
        usage = message.usage
        yield LLMResult(
            text="".join(block.text for block in message.content if block.type == "text"),
            model=message.model,
            stop_reason=message.stop_reason,
            request_id=message._request_id,
            input_tokens=usage.input_tokens if usage else None,
            output_tokens=usage.output_tokens if usage else None,
        )


# The CLIs' own time limits (agy --print-timeout) or ours; this margin only catches a hung process.
CLI_GRACE_S = 15
CLI_TOOL_RULE = "只用文字直接回答使用者的最後一個問題；不要使用任何工具、不要執行指令、不要讀寫檔案、不要瀏覽網頁。"
AUTH_ERROR = re.compile(r"log ?in|sign ?in|auth|unauthori[sz]ed|\b401\b", re.I)


def cli_prompt(system: str | None, messages: list[dict]) -> str:
    """One prompt for CLIs that take a single message: the rules (unless the CLI accepts a system
    prompt of its own), the no-tools rule, earlier turns, then the question with its context block."""
    parts = [system.strip(), ""] if system else []
    parts += ["# 輸出規則", CLI_TOOL_RULE]
    if len(messages) > 1:
        parts += ["", "# 先前的對話（僅供參考）"]
        parts += [f"[{'使用者' if m['role'] == 'user' else '助手'}] {m['content']}" for m in messages[:-1]]
    parts += ["", "# 目前的問題", messages[-1]["content"]]
    return "\n".join(parts)


def parse_agy_event(line: str | bytes) -> tuple[str, object] | None:
    """One `agy --output-format stream-json` line -> ("delta", text) | ("result", dict) | None."""
    try:
        data = json.loads(line)
    except ValueError:
        return None
    if data.get("event") == "step_update":
        step = data.get("step_update") or {}
        if step.get("step_type") == "agent_response" and step.get("text_delta"):
            return "delta", step["text_delta"]
    elif data.get("event") == "result":
        return "result", data.get("result") or {}
    return None


class CliProvider:
    """A local AI CLI (its own login and subscription quota), run headless once per request.

    Each run happens in a private empty directory with tools disabled or sandboxed (per CLI), so it
    sees no project files and cannot change anything; the prompt also forbids tool use. Subclasses
    say how to call their CLI and how to read its JSON-lines output.
    """

    label = "cli"

    def __init__(self, command: str, model: str | None = None, effort: str | None = None, timeout_s: float = 180) -> None:
        executable = shutil.which(command)
        if executable is None:
            raise LLMUnavailable(f"找不到 {self.label} CLI（{command}）")
        self.executable = executable
        self.model = model
        self.effort = effort
        self.name = f"{self.label}:{model or 'default'}" + (f" ({effort})" if effort else "")
        self.timeout_s = timeout_s
        self._workdir: str | None = None

    def _cwd(self) -> str:
        if self._workdir is None:
            self._workdir = tempfile.mkdtemp(prefix=f"crazyhouse-{self.label}-")
        return self._workdir

    def close(self) -> None:
        """Remove the private working directory (whatever the CLI may have left in it)."""
        if self._workdir is not None:
            shutil.rmtree(self._workdir, ignore_errors=True)
            self._workdir = None

    def command(self, system: str, messages: list[dict]) -> tuple[list[str], str | None]:
        """Arguments, and the text to send on stdin (None: nothing)."""
        raise NotImplementedError

    def parse(self, line: bytes) -> tuple[str, object] | None:
        """One output line -> ("delta", text) | ("done", {"text"?, "request_id"?, "usage"?}) |
        ("error", message) | None."""
        raise NotImplementedError

    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str | LLMResult]:
        args, stdin_text = self.command(system, messages)
        try:
            process = await asyncio.create_subprocess_exec(
                self.executable,
                *args,
                cwd=self._cwd(),
                stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as error:
            raise LLMUnavailable(f"無法啟動 {self.label} CLI：{error}") from error
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.timeout_s + CLI_GRACE_S
        assert process.stdout is not None and process.stderr is not None
        stderr = asyncio.ensure_future(process.stderr.read())  # drained concurrently: a full pipe would block the CLI
        text_parts: list[str] = []
        done: dict | None = None
        error: str | None = None
        try:
            if stdin_text is not None:
                assert process.stdin is not None
                process.stdin.write(stdin_text.encode())
                await process.stdin.drain()
                process.stdin.close()
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise LLMError("AI 回答逾時")
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), remaining)
                except TimeoutError as timeout:
                    raise LLMError("AI 回答逾時") from timeout
                if not line:
                    break
                parsed = self.parse(line)
                if parsed is None:
                    continue
                kind, value = parsed
                if kind == "delta":
                    text_parts.append(str(value))
                    yield str(value)
                elif kind == "done":
                    done = value  # type: ignore[assignment]
                else:
                    error = str(value)
            await process.wait()
        finally:
            if process.returncode is None:  # consumer went away or we failed: never leave a run spending quota
                process.kill()
                await process.wait()
            stderr_text = (await stderr).decode(errors="replace")

        if done is None or error is not None:
            detail = error or stderr_text
            first = detail.strip().splitlines()[0] if detail.strip() else f"exit code {process.returncode}"
            log.error("%s failed: %s", self.label, first)
            if AUTH_ERROR.search(first):
                raise LLMUnavailable(f"{self.label} 尚未登入或授權失效：{first}")
            raise LLMError(f"AI 服務錯誤：{first}")
        text = str(done.get("text") or "".join(text_parts)).strip()
        if not text:
            raise LLMError("AI 沒有產生回答")
        usage = done.get("usage") or {}
        yield LLMResult(
            text=text,
            model=self.name,
            stop_reason="end_turn",
            request_id=done.get("request_id"),
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
        )


def _json(line: bytes) -> dict | None:
    try:
        data = json.loads(line)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


class AgyProvider(CliProvider):
    """`agy -p` (Antigravity): plan mode, terminal sandbox, its own time limit."""

    label = "agy"

    def command(self, system: str, messages: list[dict]) -> tuple[list[str], str | None]:
        args = ["-p", cli_prompt(system, messages)]
        if self.model:
            args += ["--model", self.model]
        if self.effort:
            args += ["--effort", self.effort]
        args += ["--output-format", "stream-json", "--mode", "plan", "--sandbox", "--print-timeout", f"{int(self.timeout_s)}s"]
        return args, None

    def parse(self, line: bytes) -> tuple[str, object] | None:
        parsed = parse_agy_event(line)
        if parsed is None or parsed[0] == "delta":
            return parsed
        result = parsed[1]
        assert isinstance(result, dict)
        if result.get("status") != "SUCCESS":
            return "error", result.get("error") or f"status {result.get('status')}"
        return "done", {"text": result.get("response"), "request_id": result.get("conversation_id"),
                        "usage": result.get("usage")}


class CodexProvider(CliProvider):
    """`codex exec` (OpenAI Codex): read-only sandbox, no session kept, prompt on stdin. Codex reports
    the answer as one message when it is complete (no partial text)."""

    label = "codex"

    def command(self, system: str, messages: list[dict]) -> tuple[list[str], str | None]:
        args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", self._cwd()]
        if self.model:
            args += ["-m", self.model]
        if self.effort:
            args += ["-c", f'model_reasoning_effort="{self.effort}"']
        return [*args, "-"], cli_prompt(system, messages)

    def parse(self, line: bytes) -> tuple[str, object] | None:
        data = _json(line)
        if data is None:
            return None
        kind = data.get("type")
        item = data.get("item") or {}
        if kind == "item.completed" and item.get("type") == "agent_message" and item.get("text"):
            return "delta", item["text"]
        if kind == "turn.completed":
            usage = data.get("usage") or {}
            return "done", {"usage": {"input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens")}}
        if kind == "turn.failed":
            return "error", (data.get("error") or {}).get("message") or "turn failed"
        if kind == "error":
            return "error", data.get("message") or "error"
        return None


class ClaudeCliProvider(CliProvider):
    """`claude -p` (Claude Code): our system prompt replaces the default one, all tools, MCP servers and
    setting files are off, nothing is persisted; partial text is streamed."""

    label = "claude"

    def command(self, system: str, messages: list[dict]) -> tuple[list[str], str | None]:
        args = [
            "-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose",
            "--system-prompt", system, "--tools", "", "--no-session-persistence",
            "--strict-mcp-config", "--setting-sources", "",
        ]  # fmt: skip
        if self.model:
            args += ["--model", self.model]
        if self.effort:
            args += ["--effort", self.effort]
        return args, cli_prompt(None, messages)

    def parse(self, line: bytes) -> tuple[str, object] | None:
        data = _json(line)
        if data is None:
            return None
        if data.get("type") == "stream_event":
            event = data.get("event") or {}
            delta = event.get("delta") or {}
            if event.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                return "delta", delta.get("text", "")
            return None
        if data.get("type") == "result":
            if data.get("is_error") or data.get("subtype") != "success":
                return "error", data.get("result") or data.get("subtype") or "error"
            return "done", {"text": data.get("result"), "request_id": data.get("session_id"), "usage": data.get("usage")}
        return None


@dataclass
class FakeProvider:
    """Deterministic stand-in for tests and UI wiring checks. It never claims to be a real model:
    it echoes what it was given so tests can verify the context the LLM would receive."""

    name: str = "fake"
    calls: list[dict] = field(default_factory=list)

    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str | LLMResult]:
        self.calls.append({"system": system, "messages": messages})
        last = messages[-1]["content"]
        match = re.search(r"<position_context>\n(.*?)\n</position_context>", last, re.S)
        context = json.loads(match.group(1)) if match else {}
        position = context.get("position", {})
        best = (context.get("engine") or {}).get("best_move") or {}
        question = last.rsplit("</position_context>", 1)[-1].strip()
        text = (
            f"[FAKE LLM] position_id={position.get('position_id')} variation_id={position.get('variation_id')} "
            f"fen={position.get('fen')} side_to_move={position.get('side_to_move')} best={best.get('san')} "
            f"turns={len(messages)} question={question}"
        )
        for start in range(0, len(text), 40):  # stream in small chunks like a real model
            yield text[start : start + 40]
            await asyncio.sleep(0.02)
        yield LLMResult(text=text, model=self.name, stop_reason="end_turn")

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


# agy enforces --print-timeout itself; this extra margin only catches a hung process.
AGY_GRACE_S = 15
AGY_TOOL_RULE = "只用文字直接回答使用者的最後一個問題；不要使用任何工具、不要讀寫檔案、不要瀏覽網頁。"


def agy_prompt(system: str, messages: list[dict]) -> str:
    """agy has no system role: the rules lead the single prompt, then earlier turns, then the question."""
    parts = [system.strip(), "", "# 輸出規則", AGY_TOOL_RULE]
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


class AgyProvider:
    """The local `agy` CLI (its own login and subscription quota), run headless per request.

    Each run happens in a private empty directory in plan mode with the terminal sandbox on, so the
    agent sees no project files and cannot edit anything; the prompt also forbids tool use.
    """

    def __init__(self, model: str, command: str = "agy", timeout_s: float = 180) -> None:
        executable = shutil.which(command)
        if executable is None:
            raise LLMUnavailable(f"找不到 agy CLI（AGY_PATH={command}）")
        self.executable = executable
        self.model = model
        self.name = f"agy:{model}"
        self.timeout_s = timeout_s
        self._workdir: str | None = None

    def _cwd(self) -> str:
        if self._workdir is None:
            self._workdir = tempfile.mkdtemp(prefix="crazyhouse-agy-")
        return self._workdir

    async def stream(self, system: str, messages: list[dict]) -> AsyncIterator[str | LLMResult]:
        args = [
            "-p", agy_prompt(system, messages),
            "--model", self.model,
            "--output-format", "stream-json",
            "--mode", "plan",
            "--sandbox",
            "--print-timeout", f"{int(self.timeout_s)}s",
        ]  # fmt: skip
        try:
            process = await asyncio.create_subprocess_exec(
                self.executable,
                *args,
                cwd=self._cwd(),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as error:
            raise LLMUnavailable(f"無法啟動 agy CLI：{error}") from error
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.timeout_s + AGY_GRACE_S
        result: dict | None = None
        assert process.stdout is not None and process.stderr is not None
        stderr = asyncio.ensure_future(process.stderr.read())  # drained concurrently: a full pipe would block agy
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise LLMError("AI 回答逾時")
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), remaining)
                except TimeoutError as error:
                    raise LLMError("AI 回答逾時") from error
                if not line:
                    break
                parsed = parse_agy_event(line)
                if parsed is None:
                    continue
                kind, value = parsed
                if kind == "delta":
                    yield str(value)
                else:
                    result = value  # type: ignore[assignment]
            await process.wait()
        finally:
            if process.returncode is None:  # consumer went away or we failed: never leave a run spending quota
                process.kill()
                await process.wait()
            stderr_text = (await stderr).decode(errors="replace")

        if result is None or result.get("status") != "SUCCESS":
            detail = (result or {}).get("error") or stderr_text
            first = detail.strip().splitlines()[0] if detail.strip() else f"exit code {process.returncode}"
            log.error("agy failed: %s", first)
            if re.search(r"log ?in|sign ?in|auth", first, re.I):
                raise LLMUnavailable(f"agy 尚未登入或授權失效：{first}")
            raise LLMError(f"AI 服務錯誤：{first}")
        text = str(result.get("response") or "").strip()
        if not text:
            raise LLMError("AI 沒有產生回答")
        usage = result.get("usage") or {}
        yield LLMResult(
            text=text,
            model=self.name,
            stop_reason="end_turn",
            request_id=result.get("conversation_id"),
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
        )


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

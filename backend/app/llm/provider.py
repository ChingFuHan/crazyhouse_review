"""Thin LLM provider boundary: upper layers never import a vendor SDK directly."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
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

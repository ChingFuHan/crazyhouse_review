"""Thin LLM provider boundary: upper layers never import a vendor SDK directly."""

from __future__ import annotations

import json
import logging
import os
import re
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

    async def complete(self, system: str, messages: list[dict]) -> LLMResult: ...


class AnthropicProvider:
    """Claude via the official SDK. Credentials come from the environment (.env), never from code."""

    def __init__(self, model: str, effort: str, max_tokens: int, client: anthropic.AsyncAnthropic | None = None) -> None:
        if client is None and not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            raise LLMUnavailable("LLM 未設定：請在 .env 設定 ANTHROPIC_API_KEY")
        self.name = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.client = client or anthropic.AsyncAnthropic()

    async def complete(self, system: str, messages: list[dict]) -> LLMResult:
        try:
            response = await self.client.beta.messages.create(
                model=self.name,
                max_tokens=self.max_tokens,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                output_config={"effort": self.effort},
                # On a safety decline, retry server-side on Anthropic's recommended model.
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
            raise LLMUnavailable("LLM 憑證無效或沒有權限（請檢查 .env 的 ANTHROPIC_API_KEY）") from error
        except anthropic.RateLimitError as error:
            raise LLMError("LLM 請求過於頻繁，請稍後再試") from error
        except anthropic.APIStatusError as error:
            log.error("LLM API error %s (request %s)", error.status_code, error.request_id)
            raise LLMError(f"LLM 服務錯誤（HTTP {error.status_code}）") from error
        except anthropic.APIConnectionError as error:
            raise LLMError("無法連線到 LLM 服務") from error

        usage = response.usage
        if response.stop_reason == "refusal":
            return LLMResult("", response.model, "refusal", refused=True, request_id=response._request_id)
        text = "".join(block.text for block in response.content if block.type == "text")
        return LLMResult(
            text=text,
            model=response.model,
            stop_reason=response.stop_reason,
            request_id=response._request_id,
            input_tokens=usage.input_tokens if usage else None,
            output_tokens=usage.output_tokens if usage else None,
        )


@dataclass
class FakeProvider:
    """Deterministic stand-in for tests and UI wiring checks. It never claims to be a real model:
    it echoes what it was given so tests can verify the context the LLM would receive."""

    name: str = "fake"
    calls: list[dict] = field(default_factory=list)

    async def complete(self, system: str, messages: list[dict]) -> LLMResult:
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
        return LLMResult(text=text, model=self.name, stop_reason="end_turn")

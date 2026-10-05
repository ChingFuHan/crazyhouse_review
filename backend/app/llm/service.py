"""Explanation service: question + canonical context -> LLM answer, cached by content."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import OrderedDict
from pathlib import Path

from ..models import ChatTurn
from .context import CONTEXT_VERSION, render_user_message
from .provider import LLMProvider, LLMResult, LLMUnavailable

SYSTEM_PROMPT = (Path(__file__).parent / "system_prompt.md").read_text(encoding="utf-8")
PROMPT_VERSION = hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:8]
CACHE_SIZE = 256

DEFAULT_QUESTION = (
    "請解釋這個局面的最佳著：它的直接作用、真正目的、對手為什麼難處理、"
    "依 engine 主要變化的後續，以及與其他候選著的差異；最後指出值得記住的 Crazyhouse pattern。"
)


def cache_key(context: dict, question: str, history: list[ChatTurn], model: str) -> str:
    """Distinguishes position_id, variation_id, engine result (analysis_id), context and prompt
    versions, question and conversation — all are inside `context` or listed here."""
    material = json.dumps(
        [CONTEXT_VERSION, PROMPT_VERSION, model, context, question, [t.model_dump() for t in history]],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(material.encode()).hexdigest()


class ExplainService:
    def __init__(self, provider: LLMProvider | None, unavailable_reason: str = "LLM 未設定") -> None:
        self.provider = provider
        self.unavailable_reason = unavailable_reason
        self._cache: OrderedDict[str, LLMResult] = OrderedDict()

    @property
    def model(self) -> str:
        if self.provider is None:
            raise LLMUnavailable(self.unavailable_reason)
        return self.provider.name

    async def ask(self, context: dict, question: str, history: list[ChatTurn]) -> tuple[LLMResult, str, bool]:
        """Returns (result, request_id, cached). Only the latest turn carries the context block."""
        model = self.model
        key = cache_key(context, question, history, model)
        request_id = uuid.uuid4().hex[:12]
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key], request_id, True
        messages = [{"role": t.role, "content": t.content} for t in history]
        messages.append({"role": "user", "content": render_user_message(context, question)})
        result = await self.provider.complete(SYSTEM_PROMPT, messages)
        if result.text and not result.refused:
            self._cache[key] = result
            if len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return result, request_id, False

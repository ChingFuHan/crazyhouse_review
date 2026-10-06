"""Which AI CLIs, models and effort levels the viewer can choose, read from the CLIs themselves.

Nothing is hard-coded: every catalog comes from the installed CLIs (`agy models` + `agy --help`,
`codex debug models`, `claude --help`), so a CLI update that adds or drops a model or effort level
shows up on the next read. A request's choice is checked against a fresh catalog before any CLI runs,
and an option that has disappeared is refused with a message instead of failing inside the CLI.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import time
from dataclasses import dataclass, field

from ..models import LlmChoice, LlmModelOption, LlmProviderOption
from .provider import AgyProvider, ClaudeCliProvider, CliProvider, CodexProvider

PROVIDERS: dict[str, type[CliProvider]] = {"agy": AgyProvider, "codex": CodexProvider, "claude": ClaudeCliProvider}
LABELS = {"agy": "agy CLI（Antigravity）", "codex": "Codex CLI", "claude": "Claude CLI（Claude Code）"}
LIST_TIMEOUT_S = 30
# A catalog this fresh is reused when checking a request; opening the settings always reads anew.
MAX_AGE_S = 120


class ChoiceError(ValueError):
    """The requested CLI, model or effort is not offered (any more); the message is for the user."""


# --- parsing what the CLIs print -------------------------------------------------------------------

def parse_help_choices(help_text: str, option: str) -> list[str]:
    """The values listed in parentheses in an option's help, e.g. `--effort  ... (low|medium|high)`
    or `(low, medium, high)`; the description may wrap over several lines."""
    match = re.search(rf"{re.escape(option)}\b[^\n]*(?:\n(?!\s*-)[^\n]*)*", help_text)
    if not match:
        return []
    listed = re.search(r"\(([^()]*)\)", match.group(0))
    if not listed:
        return []
    return [value for value in re.split(r"[|,\s]+", listed.group(1)) if re.fullmatch(r"[a-z][a-z0-9-]*", value)]


def parse_agy_models(text: str) -> list[LlmModelOption]:
    """`agy models`: one `id<TAB>label` line per model (after a progress line)."""
    models = []
    for line in text.splitlines():
        if "\t" in line:
            model_id, label = (part.strip() for part in line.split("\t", 1))
            if model_id:
                models.append(LlmModelOption(id=model_id, label=label or model_id))
    return models


def parse_codex_models(text: str) -> list[LlmModelOption]:
    """`codex debug models`: the model catalog as JSON; hidden models are left out."""
    catalog = json.loads(text)
    models = []
    for entry in catalog.get("models", []):
        if entry.get("visibility") not in (None, "list") or not entry.get("slug"):
            continue
        efforts = [level["effort"] for level in entry.get("supported_reasoning_levels") or [] if level.get("effort")]
        models.append(LlmModelOption(
            id=entry["slug"],
            label=entry.get("display_name") or entry["slug"],
            efforts=efforts or None,
            default_effort=entry.get("default_reasoning_level"),
        ))
    return models


def parse_claude_models(help_text: str) -> list[LlmModelOption]:
    """`claude --help` names the aliases it accepts for --model ('fable', 'opus', 'sonnet', …)."""
    match = re.search(r"--model\b[^\n]*(?:\n(?!\s*-)[^\n]*)*", help_text)
    aliases = re.findall(r"'([a-z][a-z0-9.\-]*)'", match.group(0)) if match else []
    return [LlmModelOption(id=alias, label=alias) for alias in dict.fromkeys(aliases)]


# --- reading the catalogs ----------------------------------------------------------------------------

async def _output(executable: str, *args: str, with_stderr: bool = False) -> str:
    """The command's output; `with_stderr` for help texts, which some CLIs (agy) print to stderr."""
    process = await asyncio.create_subprocess_exec(
        executable, *args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), LIST_TIMEOUT_S)
    except TimeoutError as error:
        process.kill()
        await process.wait()
        raise RuntimeError(f"`{' '.join(args)}` 逾時") from error
    if process.returncode != 0:
        detail = (stderr or stdout).decode(errors="replace").strip().splitlines()
        raise RuntimeError(detail[0] if detail else f"`{' '.join(args)}` exit code {process.returncode}")
    return (stdout + b"\n" + stderr if with_stderr else stdout).decode(errors="replace")


async def _read(provider: str, executable: str) -> tuple[list[LlmModelOption], list[str]]:
    if provider == "agy":
        models, help_text = await asyncio.gather(
            _output(executable, "models"), _output(executable, "--help", with_stderr=True)
        )
        return parse_agy_models(models), parse_help_choices(help_text, "--effort")
    if provider == "codex":
        models = parse_codex_models(await _output(executable, "debug", "models"))
        # Levels per model; for the CLI's own default model any level some model supports is offered.
        return models, list(dict.fromkeys(e for m in models for e in (m.efforts or [])))
    help_text = await _output(executable, "--help", with_stderr=True)
    return parse_claude_models(help_text), parse_help_choices(help_text, "--effort")


async def _option(provider: str, command: str) -> LlmProviderOption:
    executable = shutil.which(command)
    if executable is None:
        return LlmProviderOption(id=provider, label=LABELS[provider], available=False, reason=f"找不到 {command}")
    try:
        models, efforts = await _read(provider, executable)
    except (RuntimeError, OSError, ValueError) as error:
        return LlmProviderOption(id=provider, label=LABELS[provider], available=False, reason=f"無法列出 model：{error}")
    return LlmProviderOption(id=provider, label=LABELS[provider], available=True, models=models, efforts=efforts)


@dataclass
class ProviderPool:
    """The CLIs a viewer may choose: their live catalogs and one provider instance per choice."""

    commands: dict[str, str]  # provider id -> executable name or path
    timeout_s: float = 600
    _catalog: list[LlmProviderOption] = field(default_factory=list)
    _read_at: float = 0.0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _instances: dict[tuple, CliProvider] = field(default_factory=dict)

    async def catalog(self, refresh: bool = False) -> list[LlmProviderOption]:
        async with self._lock:
            if refresh or not self._catalog or time.monotonic() - self._read_at > MAX_AGE_S:
                self._catalog = list(await asyncio.gather(*(_option(p, c) for p, c in self.commands.items())))
                self._read_at = time.monotonic()
            return self._catalog

    @staticmethod
    def _problem(options: list[LlmProviderOption], choice: LlmChoice) -> str | None:
        option = next((o for o in options if o.id == choice.provider), None)
        if option is None or not option.available:
            return f"{LABELS.get(choice.provider, choice.provider)} 目前無法使用" + (f"：{option.reason}" if option and option.reason else "")
        model = next((m for m in option.models if m.id == choice.model), None)
        if choice.model is not None and model is None:
            return f"{option.label} 已不提供 model「{choice.model}」，請重新選擇"
        efforts = (model.efforts if model and model.efforts else None) or option.efforts
        if choice.effort is not None and choice.effort not in efforts:
            return f"{option.label} 不支援 effort「{choice.effort}」，請重新選擇"
        return None

    async def provider(self, choice: LlmChoice) -> CliProvider:
        """The provider for a valid choice; ChoiceError when the CLI no longer offers it."""
        problem = self._problem(await self.catalog(), choice)
        if problem is not None:  # maybe the CLI changed since the catalog was read: look again
            problem = self._problem(await self.catalog(refresh=True), choice)
        if problem is not None:
            raise ChoiceError(problem)
        key = (choice.provider, choice.model, choice.effort)
        if key not in self._instances:
            cls = PROVIDERS[choice.provider]
            self._instances[key] = cls(self.commands[choice.provider], choice.model, choice.effort, self.timeout_s)
        return self._instances[key]

    def close(self) -> None:
        for instance in self._instances.values():
            instance.close()
        self._instances.clear()

"""Bilingual documentation: every document exists as Traditional Chinese (`X.md`, the default) and
English (`X.en.md`); both start with the same language switch and stay structurally in sync."""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCS = ["README", "PROJECT_STATE", "task"]
# Runtime LLM input, not documentation: never split or decorated.
NOT_DOCS = {
    "backend/app/llm/system_prompt.md",
    "backend/app/puzzles/prompts/curate.md",
    "backend/app/puzzles/prompts/design.md",
}
# Generated or installed content (reports: scripts/llm_eval.py output, git-ignored).
SKIP_DIRS = {".git", ".venv", "node_modules", "dist", ".pytest_cache", "test-results", "playwright-report", "reports"}

BADGE = "https://img.shields.io/badge/{label}-{color}?style=for-the-badge"
CURRENT, OTHER = "0969da", "6e7781"
FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.S | re.M)
HEADING = re.compile(r"^#{1,6} ", re.M)
CJK = re.compile(r"[一-鿿]")


def path(base: str, lang: str) -> Path:
    return ROOT / (f"{base}.md" if lang == "zh" else f"{base}.en.md")


def switch(base: str, lang: str) -> str:
    zh, en = (CURRENT, OTHER) if lang == "zh" else (OTHER, CURRENT)
    return (
        '<p align="right">\n'
        f'  <a href="{base}.md"><img alt="繁體中文" src="{BADGE.format(label="%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87", color=zh)}"></a>\n'
        f'  <a href="{base}.en.md"><img alt="English" src="{BADGE.format(label="English", color=en)}"></a>\n'
        "</p>\n\n"
    )


def test_every_markdown_document_has_both_languages():
    found = {
        p.relative_to(ROOT).as_posix()
        for p in ROOT.rglob("*.md")
        if not SKIP_DIRS.intersection(p.relative_to(ROOT).parts)
    }
    expected = {path(base, lang).relative_to(ROOT).as_posix() for base in DOCS for lang in ("zh", "en")}
    assert found - NOT_DOCS == expected


@pytest.mark.parametrize("base", DOCS)
def test_both_versions_start_with_the_language_switch(base):
    for lang in ("zh", "en"):
        assert path(base, lang).read_text(encoding="utf-8").startswith(switch(base, lang)), f"{base} ({lang})"


@pytest.mark.parametrize("base", DOCS)
def test_versions_have_the_same_structure_and_identical_commands(base):
    zh, en = (path(base, lang).read_text(encoding="utf-8") for lang in ("zh", "en"))
    zh_blocks, en_blocks = FENCE.findall(zh), FENCE.findall(en)
    assert len(zh_blocks) == len(en_blocks)
    for index, (zh_block, en_block) in enumerate(zip(zh_blocks, en_blocks)):
        if not CJK.search(zh_block):  # commands, code and data are never translated
            assert zh_block == en_block, f"{base}: code block {index + 1} differs"
    headings = [len(HEADING.findall(FENCE.sub("", text))) for text in (zh, en)]
    assert headings[0] == headings[1]

#!/usr/bin/env python3
"""Stand-in for the agy / codex / claude CLIs in end-to-end tests (no subscription quota spent).

The command name decides which CLI it imitates. The model catalog can be changed by a test through
the JSON file in FAKE_CLI_STATE (e.g. to simulate a CLI update that drops a model).
"""

import json
import os
import re
import sys
import time

name = os.path.basename(sys.argv[0])
args = sys.argv[1:]
state_path = os.environ.get("FAKE_CLI_STATE", "")
state = json.load(open(state_path)) if state_path and os.path.exists(state_path) else {}
codex_models = state.get("codex_models", ["gpt-6.1-sol", "gpt-6-luna"])


# Puzzle design: the first answer is an impossible position (two white kings), so the engine's reason
# and the retry are visible; after that, a mate in one with a queen drop, whose texts are then written
# from the engine's solution.
BAD_DESIGN = "6k1/5ppp/8/8/8/8/5PPP/5KK1[Q] w - - 0 1"
GOOD_DESIGN = "6k1/5ppp/8/8/8/8/5PPP/6K1[Q] w - - 0 1"


def puzzle_answer(prompt: str) -> str | None:
    """JSON answers to the puzzle-making prompts (picking candidates, designing a position)."""
    if "</puzzle_candidates>" in prompt:  # the last block: the rules mention the tag too
        data = prompt.rsplit("<puzzle_candidates>", 1)[1].split("</puzzle_candidates>")[0]
        count = re.search(r"最傷腦筋的 (\d+) 題", prompt)
        designed = "你設計" in prompt
        picks = [{"id": c["id"], "title": "后的打入" if designed else f"假標題 {c['id']}",
                  "hint": "黑王還有出路嗎？" if designed else "先看清楚雙方王的安全",
                  "explanation": f"[FAKE {name.upper()}] 解答 {c['solution'] or ''}", "difficulty": 3}
                 for c in json.loads(data)[: int(count.group(1)) if count else None]]
        return json.dumps({"picks": picks}, ensure_ascii=False)
    if "<puzzle_request>" in prompt:
        fen = GOOD_DESIGN if "這個局面不合格" in prompt else BAD_DESIGN
        return json.dumps({"fen": fen, "title": "設計時的標題", "hint": "設計時的提示",
                           "idea": "黑王被自己的兵困住，后打入底線將殺。"}, ensure_ascii=False)
    return None


def answer(prompt: str, model: str, effort: str) -> str:
    puzzle = puzzle_answer(prompt)
    if puzzle is not None:
        return puzzle
    question = prompt.rsplit("</position_context>", 1)[-1].strip()
    fen = re.search(r'"fen": "([^"]+)"', prompt)
    return f"[FAKE {name.upper()}] model={model} effort={effort} fen={fen.group(1) if fen else None} question={question}"


def flag(option: str, default: str = "default") -> str:
    return args[args.index(option) + 1] if option in args else default


if name == "agy" and args == ["models"]:
    print("Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)")
elif name == "agy" and args == ["--help"]:  # the real agy prints its help to stderr
    sys.stderr.write("  --effort                        Reasoning effort for the current CLI session (low|medium|high|xhigh|max)\n")
elif name == "claude" and args == ["--help"]:
    print("  --effort <level>                      Effort level for the current session\n"
          "                                        (low, medium, high, xhigh, max)\n"
          "  --model <model>                       Model for the current session. Provide\n"
          "                                        an alias for the latest model (e.g.\n"
          "                                        'fable', 'opus', or 'sonnet') or a\n"
          "                                        model's full name.")
elif name == "codex" and args == ["debug", "models"]:
    levels = [{"effort": e} for e in ("low", "medium", "high")]
    print(json.dumps({"models": [{"slug": m, "display_name": m.upper(), "visibility": "list",
                                  "default_reasoning_level": "low", "supported_reasoning_levels": levels}
                                 for m in codex_models]}))
elif name == "codex" and args[:1] == ["exec"]:
    time.sleep(state.get("slow_seconds", 0))  # a slow answer, to cancel
    effort = re.search(r'model_reasoning_effort="([^"]+)"', " ".join(args))
    text = answer(sys.stdin.read(), flag("-m"), effort.group(1) if effort else "default")
    print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": text}}))
    print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}}))
elif name == "claude" and args[:1] == ["-p"]:
    text = answer(sys.stdin.read(), flag("--model"), flag("--effort"))
    print(json.dumps({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}}))
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": text, "session_id": "fake"}))
elif name == "agy" and args[:1] == ["-p"]:
    text = answer(args[1], flag("--model"), flag("--effort"))
    print(json.dumps({"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": text}}))
    print(json.dumps({"event": "result", "result": {"status": "SUCCESS", "response": text}}))
else:
    sys.stderr.write(f"fake {name}: unexpected arguments {args}\n")
    sys.exit(2)

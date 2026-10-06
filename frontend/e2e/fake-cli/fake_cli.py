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


def answer(prompt: str, model: str, effort: str) -> str:
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

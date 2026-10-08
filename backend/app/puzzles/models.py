"""Puzzle schemas: stored puzzles, players and the API shapes of the puzzle page."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from ..models import AnswerWarning, Color, LineRequest, LlmChoice, MoveModel

PuzzleType = Literal["attack", "defense", "tactics", "battle"]
PUZZLE_TYPES: tuple[PuzzleType, ...] = ("attack", "defense", "tactics", "battle")
TYPE_NAMES = {"attack": "進攻題", "defense": "防守題", "tactics": "中局攻防", "battle": "中局對轟"}
NICKNAME = r"^[^\s<>&\"'][^<>&\"']{0,23}$"


class Puzzle(BaseModel):
    """A stored puzzle. `solution` alternates solver and opponent moves (UCI) and ends with a solver
    move; a battle has no solution: the solver plays `battle_plies` moves against the engine."""

    id: int = 0
    type: PuzzleType
    fen: str = Field(description="The position to solve (crazyhouse FEN, the solver to move).")
    solver: Color
    solution: list[str] = []
    battle_plies: int | None = None
    start_chances: float | None = Field(default=None, description="Battle: solver's winning chances at the start.")
    rating: float = 1500.0
    rd: float = 350.0
    vol: float = 0.06
    plays: int = 0
    wins: float = 0.0
    themes: list[str] = []
    hardness: float = Field(default=0.0, description="0–1: how likely a human misses the answer.")
    source: dict = {}
    # Written by the agent that made or picked the puzzle (never the solution itself).
    title: str = ""
    hint: str = ""
    explanation: str = ""
    ai: str = Field(default="", description="The agent (cli:model (effort)) that wrote the texts.")
    ai_warnings: list[AnswerWarning] = []


class Player(BaseModel):
    nickname: str
    rating: float
    rd: float
    vol: float
    plays: int = 0


class PlayerRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=24, pattern=NICKNAME)


class PuzzleView(BaseModel):
    """A puzzle as the solver sees it: never the solution."""

    id: int
    type: PuzzleType
    type_name: str
    fen: str
    solver: Color
    solver_moves: int | None = Field(description="How many moves the solver must find (None for a battle).")
    battle_plies: int | None
    rating: int
    plays: int
    themes: list[str]
    rated: bool = Field(description="False when this player already had a rated attempt at it.")
    title: str = ""
    ai: str = ""


class MoveAttempt(BaseModel):
    player: str = Field(min_length=1, max_length=24, pattern=NICKNAME)
    moves: list[str] = Field(default=[], max_length=40, description="The puzzle line so far (UCI).")
    move: str = Field(max_length=10)
    hint_used: bool = False


class RatingChange(BaseModel):
    rated: bool
    score: float
    before: int
    after: int
    puzzle_before: int
    puzzle_after: int


class MoveResult(BaseModel):
    correct: bool
    played: MoveModel | None = Field(description="The solver's move (None when they gave up).")
    reply: MoveModel | None = Field(default=None, description="The opponent's answer when the puzzle goes on.")
    done: bool
    solution: list[MoveModel] = Field(default=[], description="The whole solution, once the puzzle is over.")
    rating: RatingChange | None = None
    explanation: str = Field(default="", description="The agent's explanation, once the puzzle is over.")
    ai_warnings: list[AnswerWarning] = []


class BattleMoveResult(BaseModel):
    played: MoveModel
    verdict: Literal["best", "good", "inaccuracy", "mistake", "blunder"]
    best: MoveModel | None
    chances_best: float = Field(description="Solver's winning chances (-1..1) after the engine's best move.")
    chances_played: float
    reply: MoveModel | None
    done: bool
    moves_left: int
    final_chances: float | None = None
    result: float | None = Field(default=None, description="1 won / 0.5 held / 0 lost, when done.")
    rating: RatingChange | None = None
    explanation: str = ""
    ai_warnings: list[AnswerWarning] = []


class GiveUpRequest(BaseModel):
    player: str = Field(min_length=1, max_length=24, pattern=NICKNAME)


class HintRequest(BaseModel):
    moves: list[str] = Field(default=[], max_length=40)


class Hint(BaseModel):
    square: str | None = Field(description="The square of the piece to move, or None for a drop.")
    drop: str | None = Field(description="The pocket piece to drop, if the move is a drop.")
    text: str = Field(default="", description="The agent's hint in words (never the move itself).")


class CreatePuzzleRequest(LineRequest):
    type: PuzzleType


class MineRequest(LineRequest):
    label: str = Field(default="", max_length=80)


class GenerateRequest(BaseModel):
    """Make puzzles with an agent: `curate` — engine self-play candidates, the agent picks the most
    puzzling and writes title / hint / explanation; `design` — the agent proposes a position of `type`
    (after `description`), the engine verifies it and reports why not, the agent tries again."""

    mode: Literal["curate", "design"] = "curate"
    count: int = Field(default=5, ge=1, le=30)
    types: list[PuzzleType] = Field(default=list(PUZZLE_TYPES), min_length=1)
    type: PuzzleType = Field(default="attack", description="design: the kind of puzzle to design.")
    description: str = Field(default="", max_length=300, description="design: what the viewer asks for.")
    llm: LlmChoice | None = None


class MadePuzzle(BaseModel):
    """A puzzle a job stored, so it can be opened directly (#/puzzles/<id>)."""

    id: int
    type: PuzzleType
    type_name: str
    title: str = ""


class PuzzleJob(BaseModel):
    job_id: str
    kind: Literal["mine", "generate"]
    status: Literal["running", "done", "error"]
    done: int
    total: int
    found: int = 0
    message: str = ""
    log: list[str] = Field(default=[], description="What happened so far, one line per step.")
    ai: str = ""
    made: list[MadePuzzle] = Field(default=[], description="The puzzles stored when the job is done.")


class PuzzleExport(BaseModel):
    fen: str
    lichess_fen: str
    pgn: str
    lichess_analysis_url: str
    solution_shown: bool


class PuzzleStats(BaseModel):
    total: int
    by_type: dict[str, int]

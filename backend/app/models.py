"""API schemas shared by the HTTP layer and the domain modules."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Color = Literal["white", "black"]


class MoveModel(BaseModel):
    """A move with machine identity (uci) separated from display text (san)."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    uci: str
    san: str
    from_square: str | None = Field(alias="from")
    to: str
    drop: str | None = None
    promotion: str | None = None
    is_capture: bool = False


class Pockets(BaseModel):
    """Pocket contents as uppercase piece letters, strongest first (Q R B N P)."""

    white: list[str]
    black: list[str]


class Outcome(BaseModel):
    result: str
    termination: str
    winner: Color | None


class PositionState(BaseModel):
    """The canonical, serializable position.

    The identity of a position is its line: ``root_fen`` plus the UCI ``moves``
    played from it. ``position_id`` is derived from that line, so any layer can
    recompute and verify it.
    """

    position_id: str
    root_fen: str
    moves: list[str]
    ply: int
    move_number: int
    fen: str
    side_to_move: Color
    pockets: Pockets
    promoted: list[str]
    last_move: MoveModel | None
    is_check: bool
    outcome: Outcome | None
    legal_moves: list[str]


class LineRequest(BaseModel):
    root_fen: str | None = None
    moves: list[str] = []
    position_id: str | None = Field(
        default=None, description="Optional client-side id; rejected if it does not match the line."
    )


class MoveRequest(LineRequest):
    move: str = Field(description="UCI (e2e4, N@e7, e7e8q) or SAN (e4, N@e7+, exd8=Q).")


class PgnRequest(BaseModel):
    pgn: str = Field(max_length=500_000)


class GameNode(BaseModel):
    state: PositionState
    comment: str = ""
    children: list[GameNode] = []


class GameTree(BaseModel):
    headers: dict[str, str]
    variant_assumed: bool = Field(description="True when the PGN had no Variant tag and crazyhouse was assumed.")
    root: GameNode


class AnalyzeRequest(LineRequest):
    multipv: int | None = Field(default=None, ge=1, le=5)
    movetime_ms: int | None = Field(default=None, ge=50)


class EngineLine(BaseModel):
    """One MultiPV line. Scores are always from White's point of view."""

    rank: int
    evaluation: float | None = Field(description="Pawns, White POV; null when the line is a forced mate.")
    mate: int | None = Field(description="Moves to mate, White POV: positive = White mates, negative = Black mates.")
    evaluation_pov: Literal["white"] = "white"
    depth: int
    pv: list[MoveModel]


class EngineAnalysis(BaseModel):
    position_id: str
    status: Literal["ok", "cancelled", "game_over"]
    engine: str
    multipv: int
    movetime_ms: int
    depth: int
    lines: list[EngineLine]
    best_move: MoveModel | None
    analysis_id: str
    cached: bool = False


class PieceOnSquare(BaseModel):
    square: str
    piece: str
    color: Color


class SideFacts(BaseModel):
    color: Color
    king_square: str | None
    king_escape_squares: list[str] = Field(description="Legal king steps if it were this side's turn.")
    king_zone_attacks: int = Field(description="Squares next to this king attacked by the opponent.")
    pocket: list[str]
    hanging_pieces: list[PieceOnSquare] = Field(description="Attacked by the opponent and undefended.")
    attacked_queens_rooks: list[PieceOnSquare]
    drop_check_squares: dict[str, list[str]] = Field(
        description="Pocket piece -> empty squares where dropping it would check the enemy king."
    )
    king_zone_attackers: list[str] = Field(default=[], description="Enemy pieces hitting the king or its neighbours.")
    board_material: dict[str, int] = Field(default={}, description="Pieces on the board (pocket listed separately).")


class PositionFacts(BaseModel):
    side_to_move: Color
    in_check: bool
    checkers: list[PieceOnSquare]
    legal_move_count: int
    mate_in_one: list[str] = Field(description="SAN of moves for the side to move that mate at once.")
    opponent_mate_threats: list[str] = Field(
        description="SAN of mate-in-one moves the opponent would have if it were their turn."
    )
    defenses_to_mate_threats: list[str] = Field(
        default=[],
        description="Moves after which the opponent has no mate in one: quiet drops, quiet moves, then checks.",
    )
    white: SideFacts
    black: SideFacts


class LineEffect(BaseModel):
    """A long-range attack along a line, e.g. attacker "Rd1" -> target "Qd8"."""

    attacker: str
    target: str


class OpenedFile(BaseModel):
    file: str
    kind: Literal["open", "half_open"] = Field(description="open: no pawns at all; half_open: no mover pawns")


class MoveFacts(BaseModel):
    move: MoveModel
    mover: Color
    is_check: bool
    is_mate: bool
    is_capture: bool
    captured: str | None = Field(description="Captured piece letter; '~' suffix = promoted piece (pocket gets a pawn).")
    is_drop: bool
    is_promotion: bool
    discovered_check: bool
    attacks: list[PieceOnSquare] = Field(description="Enemy K/Q/R attacked by the moved piece afterwards.")
    opponent_king_escape_before: list[str]
    opponent_king_escape_after: list[str]
    pocket_before: list[str]
    pocket_after: list[str]
    opponent_reply_count: int
    forced_replies: list[str] = Field(description="All opponent replies (SAN) when there are at most 3.")
    discovered_attacks: list[LineEffect] = Field(
        default=[], description="Enemy pieces newly attacked by the mover's OTHER long-range pieces (line opened)."
    )
    blocked_lines: list[LineEffect] = Field(
        default=[], description="Enemy long-range attacks on the mover's pieces cut by the moved/dropped piece."
    )
    opened_file: OpenedFile | None = None
    threatens_mate: list[str] = Field(
        default=[], description="Mate-in-one moves the mover would have next if the opponent did nothing."
    )
    en_prise_to: list[str] = Field(
        default=[], description="Opponent pieces that can take the moved piece at a profit (it would go to their pocket)."
    )
    tags: list[str]


class PvPly(BaseModel):
    san: str
    uci: str
    color: Color
    is_check: bool
    is_drop: bool


class CandidateFacts(BaseModel):
    rank: int
    evaluation: float | None
    mate: int | None
    evaluation_pov: Literal["white"] = "white"
    depth: int
    facts: MoveFacts
    pv: list[PvPly]
    forcing_checks: int = Field(description="Consecutive checks by the mover from the start of the PV.")


class ThreatFacts(BaseModel):
    """Engine answer to "what if the side to move passed?" (null move): the opponent's best move."""

    side: Color = Field(description="The side that would move (the opponent of the side to move).")
    best_move: str
    evaluation: float | None
    mate: int | None
    evaluation_pov: Literal["white"] = "white"
    depth: int
    pv: list[str]


class Insights(BaseModel):
    position_id: str
    analysis_id: str
    engine_status: Literal["ok", "cancelled", "game_over"]
    position: PositionFacts
    last_move: MoveFacts | None
    candidates: list[CandidateFacts]
    threat: ThreatFacts | None = None


class PgnComment(BaseModel):
    ply: int = Field(ge=0)
    text: str = Field(max_length=2000)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ExplainRequest(AnalyzeRequest):
    """Ask about the active position. Everything except the line itself is UI metadata and untrusted."""

    variation_id: str = Field(default="main", max_length=80)
    on_main_line: bool = True
    game_move: str | None = Field(
        default=None,
        description="UCI of the move actually played in the game: from this position (main line) or "
        "from the branch point (variation).",
    )
    game_move_ply: int | None = Field(default=None, ge=0, description="Moves from root before game_move.")
    comments: list[PgnComment] = Field(default=[], max_length=60)
    headers: dict[str, str] = Field(default={}, max_length=30)
    question: str | None = Field(default=None, max_length=1000)
    history: list[ChatTurn] = Field(default=[], max_length=20)


class CheckedMove(BaseModel):
    """A move named in the question and what the rules / engine said about it."""

    input: str
    legal: bool
    reason: str | None = None
    san: str | None = None
    uci: str | None = None
    source: str | None = Field(default=None, description="multipv | engine_after_move | rules | unavailable")
    multipv_rank: int | None = None
    evaluation: float | None = None
    mate: int | None = None
    evaluation_pov: Literal["white"] = "white"


class ExplainResponse(BaseModel):
    position_id: str
    variation_id: str
    analysis_id: str
    request_id: str
    context_version: str
    question: str
    text: str
    model: str
    refused: bool
    cached: bool
    checked_moves: list[CheckedMove] = []


class ReviewPly(BaseModel):
    """Engine evaluation of the position after ``ply`` moves, and the verdict on the move that led there."""

    ply: int
    position_id: str
    evaluation: float | None
    mate: int | None
    evaluation_pov: Literal["white"] = "white"
    best_move: str | None = Field(description="Engine best move (SAN) in this position.")
    best_before: str | None = Field(default=None, description="Engine best move (SAN) in the previous position.")
    played_best: bool | None = None
    played_evaluation: float | None = Field(
        default=None, description="Score of the played move searched from the previous position (White POV)."
    )
    played_mate: int | None = None
    classification: Literal["inaccuracy", "mistake", "blunder", "mate_missed", "mate_allowed"] | None = None


class ReviewJob(BaseModel):
    job_id: str
    root_fen: str
    moves: list[str]
    status: Literal["running", "done", "error"]
    done: int
    total: int
    plies: list[ReviewPly]
    error: str | None = None

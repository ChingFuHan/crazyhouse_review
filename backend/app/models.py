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

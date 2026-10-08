"""The puzzle page: players, puzzles, answers, battles, export, mining and making puzzles."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Query, Request

from ..puzzles.models import (
    PUZZLE_TYPES,
    BattleMoveResult,
    CreatePuzzleRequest,
    ExplainPuzzleRequest,
    GenerateRequest,
    GiveUpRequest,
    Hint,
    HintRequest,
    MineRequest,
    MoveAttempt,
    MoveResult,
    Player,
    PlayerHistory,
    PlayerRequest,
    PuzzleExport,
    PuzzleJob,
    PuzzleStats,
    PuzzleSummary,
    PuzzleTexts,
    PuzzleType,
    PuzzleView,
    ReportRequest,
)
from ..puzzles.service import PuzzleError, PuzzleService
from .explain import chosen_provider

router = APIRouter(prefix="/api")


def puzzles(request: Request) -> PuzzleService:
    return request.app.state.puzzles


def _error(error: PuzzleError) -> HTTPException:
    return HTTPException(status_code=422, detail={"error": "puzzle", "message": str(error)})


@router.post("/players", response_model=Player)
async def sign_in(body: PlayerRequest, request: Request) -> Player:
    """Sign in with a nickname (created on first use; no password — for the local network)."""
    try:
        return puzzles(request).player(body.nickname, create=True)[1]
    except PuzzleError as error:
        raise _error(error) from error


@router.get("/puzzles/next", response_model=PuzzleView)
async def next_puzzle(request: Request, player: str = Query(max_length=24), types: str = "") -> PuzzleView:
    wanted: list[PuzzleType] = [t for t in types.split(",") if t in PUZZLE_TYPES] or list(PUZZLE_TYPES)  # type: ignore[misc]
    try:
        return puzzles(request).next(player, wanted)
    except PuzzleError as error:
        raise _error(error) from error


@router.get("/players/{nickname}/history", response_model=PlayerHistory)
async def history(request: Request, nickname: str = Path(max_length=24)) -> PlayerHistory:
    """The player's attempts (newest first) and results by puzzle kind."""
    try:
        return puzzles(request).history(nickname)
    except PuzzleError as error:
        raise _error(error) from error


@router.get("/puzzles", response_model=list[PuzzleSummary])
async def library(request: Request) -> list[PuzzleSummary]:
    """Every puzzle, reported ones included (the library is small: filtering is the client's)."""
    return puzzles(request).library()


@router.get("/puzzles/stats", response_model=PuzzleStats)
async def stats(request: Request) -> PuzzleStats:
    counts = puzzles(request).store.counts()
    return PuzzleStats(total=sum(counts.values()), by_type={t: counts.get(t, 0) for t in PUZZLE_TYPES})


@router.get("/puzzles/{puzzle_id:int}", response_model=PuzzleView)
async def open_puzzle(puzzle_id: int, request: Request, player: str = Query(max_length=24)) -> PuzzleView:
    """A given puzzle, for a link to it (#/puzzles/<id>)."""
    try:
        return puzzles(request).open(player, puzzle_id)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles", response_model=PuzzleView)
async def create(body: CreatePuzzleRequest, request: Request) -> PuzzleView:
    """Make a puzzle of the chosen type from a position; the engine checks that it is one."""
    service = puzzles(request)
    try:
        return service.view(await service.create(body.root_fen, body.moves, body.type), None)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/mine", response_model=PuzzleJob)
async def mine(body: MineRequest, request: Request) -> PuzzleJob:
    """Find puzzles along a line (a game's main line), in the background."""
    try:
        return puzzles(request).mine(body.root_fen, body.moves, body.label)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/generate", response_model=PuzzleJob)
async def generate(body: GenerateRequest, request: Request) -> PuzzleJob:
    """Make new puzzles in the background with the agent the viewer picked (server default if none):
    `curate` — the agent picks among engine self-play candidates and writes title / hint / explanation;
    `design` — the agent proposes positions of `type`, verified by the engine."""
    provider = await chosen_provider(body.llm, request) or request.app.state.explain.provider
    try:
        return puzzles(request).generate(body.count, body.types, body.mode, body.type, body.description, provider)
    except PuzzleError as error:
        raise _error(error) from error


@router.get("/puzzle-jobs/{job_id}", response_model=PuzzleJob)
async def job(job_id: str, request: Request) -> PuzzleJob:
    try:
        return puzzles(request).job(job_id)
    except PuzzleError as error:
        raise HTTPException(status_code=404, detail={"error": "unknown_job", "message": str(error)}) from error


@router.post("/puzzles/{puzzle_id}/move", response_model=MoveResult)
async def move(puzzle_id: int, body: MoveAttempt, request: Request) -> MoveResult:
    try:
        return await puzzles(request).move(puzzle_id, body.player, body.moves, body.move, body.hint_level)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/{puzzle_id}/giveup", response_model=MoveResult)
async def give_up(puzzle_id: int, body: GiveUpRequest, request: Request) -> MoveResult:
    try:
        return puzzles(request).give_up(puzzle_id, body.player)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/{puzzle_id}/hint", response_model=Hint)
async def hint(puzzle_id: int, body: HintRequest, request: Request) -> Hint:
    try:
        return puzzles(request).hint(puzzle_id, body.moves)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/{puzzle_id}/explain", response_model=PuzzleTexts)
async def explain(puzzle_id: int, body: ExplainPuzzleRequest, request: Request) -> PuzzleTexts:
    """The agent's explanation of a puzzle the player has attempted (written once, then stored)."""
    provider = await chosen_provider(body.llm, request) or request.app.state.explain.provider
    try:
        return await puzzles(request).explain(puzzle_id, body.player, provider)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/{puzzle_id}/report", status_code=204)
async def report(puzzle_id: int, body: ReportRequest, request: Request) -> None:
    """Take a broken puzzle out of the rotation."""
    try:
        puzzles(request).report(puzzle_id, body.player, body.reason)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/{puzzle_id}/restore", status_code=204)
async def restore(puzzle_id: int, request: Request) -> None:
    try:
        puzzles(request).restore(puzzle_id)
    except PuzzleError as error:
        raise _error(error) from error


@router.post("/puzzles/{puzzle_id}/battle", response_model=BattleMoveResult)
async def battle(puzzle_id: int, body: MoveAttempt, request: Request) -> BattleMoveResult:
    try:
        return await puzzles(request).battle_move(puzzle_id, body.player, body.moves, body.move)
    except PuzzleError as error:
        raise _error(error) from error


@router.get("/puzzles/{puzzle_id}/export", response_model=PuzzleExport)
async def export(puzzle_id: int, request: Request, player: str = Query(default="", max_length=24)) -> PuzzleExport:
    """FEN, PGN and lichess link; the solution is included once this player has attempted the puzzle."""
    service = puzzles(request)
    try:
        found = service.store.player(player) if player else None
        attempted = found is not None and service.store.attempted(found[0], puzzle_id)
        return service.export(puzzle_id, with_solution=attempted)
    except PuzzleError as error:
        raise _error(error) from error

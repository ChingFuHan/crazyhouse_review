"""Puzzles, players and attempts in a small SQLite database (standard library, one file).

The database lives in DATA_DIR (default backend/data, git-ignored). All calls are short queries made
from the event loop; a lock serialises them.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

from ..chess_core import normalize_root_fen
from .models import Player, Puzzle, PuzzleType
from .rating import Rating

SCHEMA = """
create table if not exists puzzles (
    id integer primary key,
    type text not null,
    fen text not null,
    solver text not null,
    solution text not null,
    battle_plies integer,
    start_chances real,
    rating real not null,
    rd real not null,
    vol real not null,
    plays integer not null default 0,
    wins real not null default 0,
    themes text not null default '[]',
    hardness real not null default 0,
    source text not null default '{}',
    created_at real not null,
    unique (fen, type)
);
create table if not exists players (
    id integer primary key,
    nickname text not null unique collate nocase,
    rating real not null,
    rd real not null,
    vol real not null,
    created_at real not null
);
create table if not exists attempts (
    id integer primary key,
    player_id integer not null references players(id),
    puzzle_id integer not null references puzzles(id),
    score real not null,
    player_before real not null,
    player_after real not null,
    puzzle_before real not null,
    puzzle_after real not null,
    created_at real not null,
    unique (player_id, puzzle_id)
);
"""
# How far (rating points) from the player's rating a puzzle is first looked for; widened step by step.
RATING_WINDOWS = (100, 200, 400, 800, 10_000)


class PuzzleStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # --- puzzles -------------------------------------------------------------------------------------

    def add(self, puzzle: Puzzle) -> Puzzle | None:
        """Store a new puzzle; None if the same position is already a puzzle of that type."""
        fen = normalize_root_fen(puzzle.fen)
        with self._lock:
            cursor = self._db.execute(
                "insert or ignore into puzzles (type, fen, solver, solution, battle_plies, start_chances, rating, rd,"
                " vol, themes, hardness, source, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (puzzle.type, fen, puzzle.solver, json.dumps(puzzle.solution), puzzle.battle_plies,
                 puzzle.start_chances, puzzle.rating, puzzle.rd, puzzle.vol, json.dumps(puzzle.themes),
                 puzzle.hardness, json.dumps(puzzle.source), time.time()),
            )  # fmt: skip
            self._db.commit()
            if cursor.rowcount == 0:
                return None
            row_id = cursor.lastrowid
        return self.get(row_id)

    def get(self, puzzle_id: int) -> Puzzle | None:
        with self._lock:
            row = self._db.execute("select * from puzzles where id = ?", (puzzle_id,)).fetchone()
        return _puzzle(row) if row else None

    def next_for(self, player_id: int, rating: float, types: list[PuzzleType]) -> Puzzle | None:
        """A puzzle of one of `types` the player has not had a rated attempt at, rated close to them."""
        marks = ",".join("?" for _ in types)
        with self._lock:
            for window in RATING_WINDOWS:
                row = self._db.execute(
                    f"select * from puzzles where type in ({marks}) and abs(rating - ?) <= ?"
                    " and id not in (select puzzle_id from attempts where player_id = ?)"
                    " order by random() limit 1",
                    (*types, rating, window, player_id),
                ).fetchone()
                if row:
                    return _puzzle(row)
            # Every puzzle was played: offer one again (unrated).
            row = self._db.execute(
                f"select * from puzzles where type in ({marks}) order by random() limit 1", tuple(types)
            ).fetchone()
        return _puzzle(row) if row else None

    def counts(self) -> dict[str, int]:
        with self._lock:
            rows = self._db.execute("select type, count(*) as n from puzzles group by type").fetchall()
        return {row["type"]: row["n"] for row in rows}

    # --- players and attempts ------------------------------------------------------------------------

    def player(self, nickname: str, create: bool = False) -> tuple[int, Player] | None:
        with self._lock:
            row = self._db.execute("select * from players where nickname = ?", (nickname,)).fetchone()
            if row is None and create:
                fresh = Rating()
                self._db.execute(
                    "insert into players (nickname, rating, rd, vol, created_at) values (?, ?, ?, ?, ?)",
                    (nickname, fresh.rating, fresh.rd, fresh.vol, time.time()),
                )
                self._db.commit()
                row = self._db.execute("select * from players where nickname = ?", (nickname,)).fetchone()
            if row is None:
                return None
            plays = self._db.execute("select count(*) from attempts where player_id = ?", (row["id"],)).fetchone()[0]
        return row["id"], Player(nickname=row["nickname"], rating=row["rating"], rd=row["rd"], vol=row["vol"], plays=plays)

    def attempted(self, player_id: int, puzzle_id: int) -> bool:
        with self._lock:
            row = self._db.execute(
                "select 1 from attempts where player_id = ? and puzzle_id = ?", (player_id, puzzle_id)
            ).fetchone()
        return row is not None

    def record(self, player_id: int, player: Rating, puzzle: Puzzle, new_player: Rating, new_puzzle: Rating,
               score: float) -> bool:
        """Store the first attempt of a player at a puzzle and both new ratings; False if it was not the
        first (replays are never rated)."""
        with self._lock:
            cursor = self._db.execute(
                "insert or ignore into attempts (player_id, puzzle_id, score, player_before, player_after,"
                " puzzle_before, puzzle_after, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
                (player_id, puzzle.id, score, player.rating, new_player.rating, puzzle.rating, new_puzzle.rating,
                 time.time()),
            )  # fmt: skip
            if cursor.rowcount == 0:
                return False
            self._db.execute(
                "update players set rating = ?, rd = ?, vol = ? where id = ?",
                (new_player.rating, new_player.rd, new_player.vol, player_id),
            )
            self._db.execute(
                "update puzzles set rating = ?, rd = ?, vol = ?, plays = plays + 1, wins = wins + ? where id = ?",
                (new_puzzle.rating, new_puzzle.rd, new_puzzle.vol, score, puzzle.id),
            )
            self._db.commit()
        return True


def _puzzle(row: sqlite3.Row) -> Puzzle:
    return Puzzle(
        id=row["id"],
        type=row["type"],
        fen=row["fen"],
        solver=row["solver"],
        solution=json.loads(row["solution"]),
        battle_plies=row["battle_plies"],
        start_chances=row["start_chances"],
        rating=row["rating"],
        rd=row["rd"],
        vol=row["vol"],
        plays=row["plays"],
        wins=row["wins"],
        themes=json.loads(row["themes"]),
        hardness=row["hardness"],
        source=json.loads(row["source"]),
    )

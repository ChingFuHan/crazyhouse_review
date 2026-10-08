"""Glicko-2 ratings and the puzzle database."""

import pytest

from app.puzzles.models import Puzzle
from app.puzzles.rating import MIN_RD, Rating, play, update
from app.puzzles.store import PuzzleStore

MATE_FEN = "6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"


def test_glicko2_matches_the_worked_example_of_the_paper():
    player = Rating(1500, 200, 0.06)
    after = update(player, [(Rating(1400, 30), 1), (Rating(1550, 100), 0), (Rating(1700, 300), 0)])
    assert after.rating == pytest.approx(1464.06, abs=0.05)
    assert after.rd == pytest.approx(151.52, abs=0.05)
    assert after.vol == pytest.approx(0.05999, abs=1e-5)


def test_solving_raises_the_player_and_lowers_the_puzzle():
    player, puzzle = play(Rating(1500, 100), Rating(1600, 80), 1)
    assert player.rating > 1500 and puzzle.rating < 1600
    loser, harder = play(Rating(1500, 100), Rating(1400, 80), 0)
    assert loser.rating < 1500 and harder.rating > 1400
    settled = Rating(1500, 50)
    for _ in range(50):
        settled, _ = play(settled, Rating(1500, 50), 0.5)
    assert settled.rd >= MIN_RD, "the deviation never collapses"


def puzzle(**fields) -> Puzzle:
    return Puzzle(**{"type": "attack", "fen": MATE_FEN, "solver": "white", "solution": ["R@d8"], **fields})


def test_store_keeps_puzzles_players_and_one_rated_attempt_each(tmp_path):
    store = PuzzleStore(tmp_path / "db.sqlite")
    stored = store.add(puzzle(rating=1450, themes=["drop_mate"]))
    assert stored.id and stored.solution == ["R@d8"] and stored.themes == ["drop_mate"]
    assert store.add(puzzle()) is None, "the same position is one puzzle per type"
    assert store.add(puzzle(type="battle", solution=[], battle_plies=6)) is not None
    assert store.counts() == {"attack": 1, "battle": 1}

    assert store.player("Ann") is None
    player_id, ann = store.player("Ann", create=True)
    assert ann.rating == 1500 and store.player("ann")[0] == player_id, "nicknames ignore case"
    assert store.next_for(player_id, ann.rating, ["attack"]).id == stored.id

    new_player, new_puzzle = play(Rating(ann.rating, ann.rd, ann.vol), Rating(stored.rating, stored.rd, stored.vol), 1)
    assert store.record(player_id, Rating(ann.rating, ann.rd, ann.vol), stored, new_player, new_puzzle, 1)
    assert not store.record(player_id, Rating(), stored, new_player, new_puzzle, 0), "a replay is not rated"
    assert store.player("Ann")[1].rating == pytest.approx(new_player.rating) and store.player("Ann")[1].plays == 1
    again = store.get(stored.id)
    assert again.plays == 1 and again.wins == 1 and again.rating == pytest.approx(new_puzzle.rating)
    # Every attack puzzle was played: one is offered again (it will not be rated).
    assert store.next_for(player_id, 1500, ["attack"]).id == stored.id
    assert store.attempted(player_id, stored.id)
    store.close()


def test_next_puzzle_prefers_ratings_close_to_the_player(tmp_path):
    store = PuzzleStore(tmp_path / "db.sqlite")
    store.add(puzzle(fen="6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1", rating=900))
    near = store.add(puzzle(fen="6k1/5ppp/8/8/8/8/5PPP/5K2[R] w - - 0 1", rating=1520))
    store.add(puzzle(fen="6k1/5ppp/8/8/8/8/5PPP/4K3[R] w - - 0 1", rating=2300))
    player_id, _ = store.player("Bo", create=True)
    assert {store.next_for(player_id, 1500, ["attack"]).id for _ in range(10)} == {near.id}
    store.close()


def test_each_chosen_kind_is_as_likely_however_many_puzzles_it_has(tmp_path):
    store = PuzzleStore(tmp_path / "db.sqlite")
    for i in range(10):
        store.add(puzzle(type="battle", fen=f"6k1/5ppp/8/8/8/8/5PPP/5K2[R] w - - 0 {i + 1}", rating=1500))
    store.add(puzzle(rating=1500))
    player_id, _ = store.player("Cy", create=True)
    kinds = [store.next_for(player_id, 1500, ["attack", "battle"]).type for _ in range(60)]
    assert kinds.count("attack") >= 15, "1 attack among 10 battles still comes up about half the time"
    store.close()


def test_a_reported_puzzle_leaves_the_rotation_until_restored(tmp_path):
    store = PuzzleStore(tmp_path / "db.sqlite")
    broken = store.add(puzzle(rating=1500))
    player_id, _ = store.player("Di", create=True)
    assert store.set_disabled(broken.id, True, "Di：解答不對")
    assert store.next_for(player_id, 1500, ["attack"]) is None and store.counts() == {}
    assert store.get(broken.id).disabled and store.get(broken.id).report == "Di：解答不對"
    assert store.set_disabled(broken.id, False, "") and store.next_for(player_id, 1500, ["attack"]).id == broken.id
    assert not store.set_disabled(999, True, "")
    store.close()


def test_history_lists_attempts_newest_first(tmp_path):
    store = PuzzleStore(tmp_path / "db.sqlite")
    first = store.add(puzzle(rating=1400))
    second = store.add(puzzle(fen="6k1/5ppp/8/8/8/8/5PPP/5K2[R] w - - 0 1", rating=1600))
    player_id, _ = store.player("Ed", create=True)
    for stored, score in ((first, 1.0), (second, 0.0)):
        before = Rating()
        new_player, new_puzzle = play(before, Rating(stored.rating, stored.rd, stored.vol), score)
        store.record(player_id, before, stored, new_player, new_puzzle, score)
    history = store.history(player_id)
    assert [(p.id, row["attempt_score"]) for p, row in history] == [(second.id, 0.0), (first.id, 1.0)]
    assert history[1][1]["player_after"] > history[1][1]["player_before"]
    store.close()


def test_an_older_database_gets_the_new_columns_and_keeps_its_puzzles(tmp_path):
    import sqlite3

    path = tmp_path / "old.sqlite"
    old = sqlite3.connect(path)
    old.executescript(
        "create table puzzles (id integer primary key, type text not null, fen text not null, solver text not null,"
        " solution text not null, battle_plies integer, start_chances real, rating real not null, rd real not null,"
        " vol real not null, plays integer not null default 0, wins real not null default 0,"
        " themes text not null default '[]', hardness real not null default 0, source text not null default '{}',"
        " created_at real not null, unique (fen, type));"
        f"insert into puzzles (type, fen, solver, solution, rating, rd, vol, created_at)"
        f" values ('attack', '{MATE_FEN}', 'white', '[\"R@d8\"]', 1400, 100, 0.06, 0);"
    )
    old.commit()
    old.close()
    store = PuzzleStore(path)
    kept = store.get(1)
    assert kept.solution == ["R@d8"] and kept.title == "" and kept.ai_warnings == []
    assert kept.before_fen == "" and kept.last_move == "" and not kept.disabled
    written = store.add(puzzle(fen="6k1/5ppp/8/8/8/8/5PPP/5K2[R] w - - 0 1", title="打入底線", hint="看看底線",
                               explanation="R@d8 將殺", ai="codex:gpt-6.1-sol (low)"))
    assert (written.title, written.hint, written.ai) == ("打入底線", "看看底線", "codex:gpt-6.1-sol (low)")
    store.close()

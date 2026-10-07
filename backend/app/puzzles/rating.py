"""Glicko-2 ratings (Glickman, "Example of the Glicko-2 system", 2012) for players and puzzles.

A puzzle attempt is one game between the player and the puzzle: both ratings move, as on lichess.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

SCALE = 173.7178
TAU = 0.5
DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL = 1500.0, 350.0, 0.06
MIN_RD, MAX_RD = 45.0, 350.0  # a floor keeps ratings responsive after many attempts


@dataclass(frozen=True)
class Rating:
    rating: float = DEFAULT_RATING
    rd: float = DEFAULT_RD
    vol: float = DEFAULT_VOL


def _g(phi: float) -> float:
    return 1 / math.sqrt(1 + 3 * phi * phi / math.pi**2)


def _expected(mu: float, mu_j: float, phi_j: float) -> float:
    return 1 / (1 + math.exp(-_g(phi_j) * (mu - mu_j)))


def update(player: Rating, games: list[tuple[Rating, float]], tau: float = TAU) -> Rating:
    """The player's rating after `games` (opponent, score 1 / 0.5 / 0) in one rating period."""
    mu, phi, sigma = (player.rating - 1500) / SCALE, player.rd / SCALE, player.vol
    if not games:
        return Rating(player.rating, min(MAX_RD, math.sqrt(phi**2 + sigma**2) * SCALE), sigma)
    opponents = [((r.rating - 1500) / SCALE, r.rd / SCALE, score) for r, score in games]
    v = 1 / sum(_g(phi_j) ** 2 * _expected(mu, mu_j, phi_j) * (1 - _expected(mu, mu_j, phi_j)) for mu_j, phi_j, _ in opponents)
    delta = v * sum(_g(phi_j) * (score - _expected(mu, mu_j, phi_j)) for mu_j, phi_j, score in opponents)

    # New volatility (Illinois algorithm, step 5 of the paper).
    a = math.log(sigma**2)

    def f(x: float) -> float:
        ex = math.exp(x)
        return ex * (delta**2 - phi**2 - v - ex) / (2 * (phi**2 + v + ex) ** 2) - (x - a) / tau**2

    big_a = a
    if delta**2 > phi**2 + v:
        big_b = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
        big_b = a - k * tau
    f_a, f_b = f(big_a), f(big_b)
    while abs(big_b - big_a) > 1e-6:
        big_c = big_a + (big_a - big_b) * f_a / (f_b - f_a)
        f_c = f(big_c)
        if f_c * f_b <= 0:
            big_a, f_a = big_b, f_b
        else:
            f_a /= 2
        big_b, f_b = big_c, f_c
    new_sigma = math.exp(big_a / 2)

    phi_star = math.sqrt(phi**2 + new_sigma**2)
    new_phi = 1 / math.sqrt(1 / phi_star**2 + 1 / v)
    new_mu = mu + new_phi**2 * sum(_g(phi_j) * (score - _expected(mu, mu_j, phi_j)) for mu_j, phi_j, score in opponents)
    rd = min(MAX_RD, max(MIN_RD, new_phi * SCALE))
    return Rating(new_mu * SCALE + 1500, rd, new_sigma)


def play(player: Rating, puzzle: Rating, score: float) -> tuple[Rating, Rating]:
    """One attempt: the player scored `score` against the puzzle (the puzzle scores the opposite)."""
    return update(player, [(puzzle, score)]), update(puzzle, [(player, 1 - score)])

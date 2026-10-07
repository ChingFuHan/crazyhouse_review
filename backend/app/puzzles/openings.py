"""Common crazyhouse openings (UCI) that self-play games for new puzzles start from."""

OPENINGS: list[list[str]] = [
    # Italian Four Knights
    "e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 f1c4 f8c5 d2d3 d7d6 c1g5 h7h6".split(),
    # French, Steinitz
    "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 e4e5 f6d7 g1f3 c7c5 d4c5 b8c6".split(),
    # Alekhine, exchange on c3
    "e2e4 g8f6 e4e5 f6d5 b1c3 d5c3 d2c3 d7d6 g1f3 b8c6 f1b5 c8g4".split(),
    # Nimzowitsch 1...Nc6
    "e2e4 b8c6 b1c3 g8f6 d2d4 d7d5 e4e5 f6e4 c3e4 d5e4 c1e3 c8f5".split(),
    # Caro-Kann, classical
    "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 g1f3 b8d7".split(),
    # Sicilian, open
    "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5".split(),
    # Queen's pawn, London
    "d2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 f8d6 f4d6 d8d6 f1d3 b8c6".split(),
    # Scandinavian
    "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5 f1c4 e7e6".split(),
]

from app.chess_core import STARTING_FEN, build_board
from app.llm.grounding import check_answer, normalize

BOARD = build_board(STARTING_FEN, ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6"])
CONTEXT = {
    "engine": {
        "evaluation": 1.8,
        "mate": None,
        "multipv": [
            {"evaluation": 1.8, "mate": None, "pv": "4.Nf3 P@f6 5.d4 d5"},
            {"evaluation": 1.2, "mate": None, "pv": "4.Ng3 e5"},
        ],
    },
    "analysis": {
        "mate_threats": {
            "opponent_mate_in_one_if_ignored": [],
            "threat_if_side_to_move_passes": {"best_move": "Bb4", "pv": ["Bb4", "a3"], "evaluation": 0.9, "mate": None},
        },
    },
    "game": {"recent_moves": "1.e4 Nf6 2.Nc3 Nxe4 3.Nxe4 e6"},
}


def flagged(answer, context=CONTEXT, kind=None):
    return [(w.kind, w.quote) for w in check_answer(answer, context, BOARD) if kind is None or w.kind == kind]


def test_normalize():
    assert normalize("@e4+") == "P@e4"
    assert normalize("exd8=Q#") == "exd8Q"
    assert normalize("0-0-0") == "O-O-O"


def test_moves_from_the_engine_and_game_data_are_grounded():
    answer = "最佳著 Nf3 之後黑方會 P@f6；實戰 3...e6 後白方 Ng3 也可行，黑方的威脅是 Bb4。"
    assert flagged(answer) == []


def test_illegal_moves_are_flagged_once():
    answer = "白方應走 Qxf7#，接著 Bxh7 與 R@h8；Qxf7# 是殺棋。e5 這格很重要。"
    assert flagged(answer) == [("illegal_move", "Qxf7#"), ("illegal_move", "Bxh7"), ("illegal_move", "R@h8")]


def test_legal_moves_the_engine_never_analysed_are_flagged():
    # Legal now, but no engine line, candidate or game move contains them: the verdict is the LLM's own.
    assert flagged("也可以考慮 N@d6+，但 Qh5 比較慢。") == [("unanalysed_move", "N@d6+"), ("unanalysed_move", "Qh5")]


def test_named_but_unanalysed_moves_are_not_evidence():
    context = {**CONTEXT, "candidate_analysis": [
        {"input": "Qh5", "legal": True, "san": "Qh5", "uci": "d1h5", "source": "engine_after_move", "line_after_move": "4...g6"},
        {"input": "Rb1", "legal": True, "san": "Rb1", "uci": "a1b1", "source": "not_analyzed"},
    ]}
    assert flagged("Qh5 不如 Nf3；Rb1 太慢。", context) == [("unanalysed_move", "Rb1")]
    # A not-analysed move that also appears in an engine line is backed by that line.
    in_pv = {**context, "engine": {**CONTEXT["engine"], "multipv": [{"evaluation": 1.8, "pv": "4.Rb1 d5"}]}}
    assert flagged("Rb1 是第一名。", in_pv) == []


def test_question_comments_and_headers_are_not_evidence():
    context = {
        **CONTEXT,
        "user_question": "Bxh7 呢？",
        "pgn_comments": [{"ply": 3, "text": "Qxf7# wins"}],
        "game": {**CONTEXT["game"], "headers": {"White": "Bxh7 fan"}},
    }
    assert flagged("Bxh7 與 Qxf7# 都不行。", context) == [("illegal_move", "Bxh7"), ("illegal_move", "Qxf7#")]


def test_evaluations_must_match_an_engine_value():
    assert flagged("白方約 +1.8，次佳 +1.2；空著的話是 +0.9。", kind="evaluation") == []
    # The side to move's point of view flips the sign: compared by absolute value, not flagged.
    assert flagged("從黑方看是 -1.8。", kind="evaluation") == []
    assert flagged("白方 +2 左右。", kind="evaluation") == []  # a whole number is a rough figure: ±0.5
    assert flagged("白方大約 +9.9，黑方 −4.2。", kind="evaluation") == [("evaluation", "+9.9"), ("evaluation", "−4.2")]
    # Results, move ranges and checks are not evaluations.
    assert flagged("1-0 的對局，2-3 步之後 N@e7+ 1 次。", kind="evaluation") == []


def test_mate_claims_must_be_backed_by_an_engine_mate():
    assert flagged("白方有三步殺。", kind="mate") == [("mate", "三步殺")]
    assert flagged("黑方沒有一步殺，也不存在 2 步將死。", kind="mate") == []  # negated statements
    with_mate = {**CONTEXT, "engine": {**CONTEXT["engine"], "mate": 3, "evaluation": None,
                                       "multipv": [{"evaluation": None, "mate": 3, "pv": "4.N@d6+ Bxd6"}]}}
    assert flagged("這是 mate in 3，走完 N@d6+ 後剩兩步殺。", with_mate, kind="mate") == []
    assert flagged("其實是五步殺，或 #7。", with_mate, kind="mate") == [("mate", "五步殺"), ("mate", "#7")]
    # A mate in one known from the rules backs "一步殺" even without an engine mate score.
    threat = {**CONTEXT, "analysis": {"mate_threats": {"opponent_mate_in_one_if_ignored": ["Q@e1#"]}}}
    assert flagged("黑方威脅一步殺。", threat, kind="mate") == []


def test_advantage_claims_need_an_engine_evaluation_for_that_side():
    assert flagged("白方明顯佔優。這對白方有利。", kind="advantage") == []
    assert flagged("黑方優勢，局面對黑方較有利。", kind="advantage") == [
        ("advantage", "黑方優勢"), ("advantage", "對黑方較有利"),
    ]
    assert flagged("黑方並非優勢。", kind="advantage") == []
    balanced = {**CONTEXT, "engine": {**CONTEXT["engine"], "multipv": [{"evaluation": -0.6, "pv": "4.Ng3 e5"}]}}
    assert flagged("黑方稍佔優。", balanced, kind="advantage") == []
    # Without any engine evaluation there is nothing to compare with: no verdict.
    assert flagged("黑方優勢。", {"game": CONTEXT["game"]}, kind="advantage") == []

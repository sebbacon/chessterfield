import chess
import chess.engine
import pytest
from analyse.engine import EngineResult, Line
from analyse.motifs import Motif
from analyse.explain import explain


def _cp(val: int) -> chess.engine.Score:
    return chess.engine.PovScore(chess.engine.Cp(val), chess.WHITE).white()


def _mate(n: int) -> chess.engine.Score:
    return chess.engine.PovScore(chess.engine.Mate(n), chess.WHITE).white()


def _make_result(best_uci="e2e4", eval_before_cp=80, eval_after_cp=120):
    board = chess.Board()
    best_move = chess.Move.from_uci(best_uci)
    return board, EngineResult(
        best_move=best_move,
        lines=[
            Line(moves=[best_move, chess.Move.from_uci("e7e5")], score=_cp(eval_after_cp)),
            Line(moves=[chess.Move.from_uci("d2d4")], score=_cp(60)),
        ],
        eval_before=_cp(eval_before_cp),
        eval_after_best=_cp(eval_after_cp),
    )


def test_explain_contains_position_header():
    board, result = _make_result()
    out = explain(board, result, [])
    assert "White to move" in out
    assert "+0.80" in out


def test_explain_contains_best_move():
    board, result = _make_result()
    out = explain(board, result, [])
    assert "Best move: e4" in out


def test_explain_contains_eval_delta():
    board, result = _make_result(eval_before_cp=80, eval_after_cp=120)
    out = explain(board, result, [])
    assert "+0.40" in out  # delta = (120 - 80) / 100


def test_explain_contains_candidates():
    board, result = _make_result()
    out = explain(board, result, [])
    assert "Candidates:" in out
    assert "1. e4" in out


def test_explain_contains_motifs():
    board, result = _make_result()
    motifs = [Motif(label="fork", confidence=0.9, detail="Nf6+ attacks Kg8 and Qd7")]
    out = explain(board, result, motifs)
    assert "Motifs:" in out
    assert "[fork 0.90]" in out
    assert "Nf6+ attacks Kg8 and Qd7" in out


def test_explain_omits_low_confidence_motifs():
    board, result = _make_result()
    motifs = [Motif(label="fork", confidence=0.4, detail="weak signal")]
    out = explain(board, result, motifs)
    assert "fork" not in out


def test_explain_shows_none_detected_when_no_motifs():
    board, result = _make_result()
    out = explain(board, result, [])
    assert "(none detected)" in out


def test_explain_mate_score_format():
    board = chess.Board()
    best_move = chess.Move.from_uci("e2e4")
    result = EngineResult(
        best_move=best_move,
        lines=[Line(moves=[best_move], score=_mate(3))],
        eval_before=_mate(3),
        eval_after_best=_mate(2),
    )
    out = explain(board, result, [])
    assert "#3" in out


def test_explain_black_to_move():
    board = chess.Board("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
    best_move = chess.Move.from_uci("e7e5")
    result = EngineResult(
        best_move=best_move,
        lines=[Line(moves=[best_move], score=_cp(-30))],
        eval_before=_cp(-30),
        eval_after_best=_cp(-10),
    )
    out = explain(board, result, [])
    assert "Black to move" in out
    assert "-0.30" in out

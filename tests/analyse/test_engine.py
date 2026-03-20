import chess
import chess.engine
import pytest
from dataclasses import dataclass
from unittest.mock import patch, MagicMock, call
from analyse.engine import analyse, EngineResult, Line


def _make_pov_score(cp: int) -> chess.engine.PovScore:
    """Helper: make a PovScore for White with given centipawn value."""
    return chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)


def _make_mock_engine(multipv_results: list[list[dict]]):
    """Return a mock SimpleEngine whose analyse() returns successive result lists."""
    mock_engine = MagicMock()
    mock_engine.analyse.side_effect = multipv_results
    mock_engine.__enter__ = lambda s: s
    mock_engine.__exit__ = MagicMock(return_value=False)
    return mock_engine


def test_analyse_returns_engine_result():
    board = chess.Board()
    pov = _make_pov_score(30)
    pov_after = _make_pov_score(25)

    mock_engine = _make_mock_engine([
        # First call: multipv=5 lines
        [
            {"score": pov, "pv": [chess.Move.from_uci("e2e4"), chess.Move.from_uci("e7e5")]},
            {"score": _make_pov_score(20), "pv": [chess.Move.from_uci("d2d4")]},
        ],
        # Second call: eval after best move
        [{"score": pov_after, "pv": [chess.Move.from_uci("e7e5")]}],
    ])

    with patch("analyse.engine.chess.engine.SimpleEngine.popen_uci", return_value=mock_engine):
        with patch("analyse.engine.shutil.which", return_value="/usr/bin/stockfish"):
            result = analyse(board, num_lines=5)

    assert isinstance(result, EngineResult)
    assert result.best_move == chess.Move.from_uci("e2e4")
    assert len(result.lines) == 2
    assert result.eval_before == pov.white()
    assert result.eval_after_best == pov_after.white()


def test_analyse_makes_two_engine_calls():
    board = chess.Board()
    pov = _make_pov_score(0)

    mock_engine = _make_mock_engine([
        [{"score": pov, "pv": [chess.Move.from_uci("e2e4")]}],
        [{"score": pov, "pv": [chess.Move.from_uci("e7e5")]}],
    ])

    with patch("analyse.engine.chess.engine.SimpleEngine.popen_uci", return_value=mock_engine):
        with patch("analyse.engine.shutil.which", return_value="/usr/bin/stockfish"):
            analyse(board, num_lines=1)

    assert mock_engine.analyse.call_count == 2


def test_analyse_raises_if_stockfish_missing():
    board = chess.Board()
    with patch("analyse.engine.shutil.which", return_value=None):
        with pytest.raises(RuntimeError, match="stockfish binary not found"):
            analyse(board)

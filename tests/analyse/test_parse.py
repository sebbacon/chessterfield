import chess
import pytest
from analyse.parse import parse_input

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

SIMPLE_PGN = """[Event "Test"]
[White "A"]
[Black "B"]

1. e4 e5 *
"""


def test_parse_fen_returns_board():
    board, last_move = parse_input(STARTING_FEN)
    assert board.fen() == STARTING_FEN
    assert last_move is None


def test_parse_fen_after_e4():
    board, last_move = parse_input(AFTER_E4_FEN)
    assert board.turn == chess.BLACK
    assert last_move is None


def test_parse_pgn_returns_final_position():
    board, last_move = parse_input(SIMPLE_PGN)
    assert board.turn == chess.WHITE  # after 1. e4 e5, White to move
    assert last_move is not None
    assert last_move == chess.Move.from_uci("e7e5")


def test_parse_invalid_raises():
    with pytest.raises(ValueError, match="could not parse"):
        parse_input("this is not chess")


def test_parse_illegal_position_raises():
    # Two white kings — illegal
    with pytest.raises(ValueError, match="illegal position"):
        parse_input("K6k/8/8/8/8/8/8/K7 w - - 0 1")

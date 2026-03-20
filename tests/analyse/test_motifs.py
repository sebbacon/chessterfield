import chess
import pytest
from analyse.motifs import detect, Motif
import chess.engine
from analyse.engine import EngineResult, Line

# ── Fork ──────────────────────────────────────────────────────────────────────
# White Ne5 can go to f7, attacking Black Qd8 and Rh8
# FEN: White Kh1 Ne5, Black Ke8 Qd8 Rh8
FORK_FEN = "3qk2r/8/8/4N3/8/8/8/7K w - - 0 1"
FORK_MOVE = chess.Move.from_uci("e5f7")   # Nf7 attacks d8 (Q) and h8 (R)

# ── Pin ───────────────────────────────────────────────────────────────────────
# White Rd1 moves to d4 (Rd4), attacked by Black Nc6 — but Nc6 is pinned to Ke8 by Bb5
PIN_FEN = "3qk3/8/2n5/1B6/8/8/8/3R3K w - - 0 1"
PIN_MOVE = chess.Move.from_uci("d1d4")   # Rd4, Nc6 would recapture but is pinned to Ke8 by Bb5

# ── Skewer ────────────────────────────────────────────────────────────────────
# White Ra1 moves to b1 (Rb1), attacking Black Qb5 (queen, val=9) on the b-file.
# Behind Qb5 on the same file is Black Rb8 (rook, val=5) — classic skewer.
SKEWER_FEN = "1r6/8/8/1q6/8/8/8/Rk5K w - - 0 1"
SKEWER_MOVE = chess.Move.from_uci("a1b1")  # Rb1 attacks Qb5 (high), then Rb8 behind (lower)

# ── Discovered Attack ─────────────────────────────────────────────────────────
# White: Kh1, Ng4 (blocks g-file), Rg1 — Ng4 moves off g-file, revealing Rg1 attacking Rg7
DISC_FEN = "6k1/6r1/8/8/6N1/8/8/6RK w - - 0 1"
DISC_MOVE = chess.Move.from_uci("g4f6")  # Nf6, reveals Rg1 attacking Rg7


def _labels(motifs):
    return [m.label for m in motifs]


def test_fork_detected():
    board = chess.Board(FORK_FEN)
    motifs = detect(board, FORK_MOVE)
    assert "fork" in _labels(motifs)


def test_fork_not_detected_on_quiet_move():
    board = chess.Board()  # Starting position
    move = chess.Move.from_uci("e2e4")
    motifs = detect(board, move)
    assert "fork" not in _labels(motifs)


def test_pin_detected():
    board = chess.Board(PIN_FEN)
    motifs = detect(board, PIN_MOVE)
    assert "pin" in _labels(motifs)


def test_skewer_detected():
    board = chess.Board(SKEWER_FEN)
    motifs = detect(board, SKEWER_MOVE)
    assert "skewer" in _labels(motifs)


def test_discovered_attack_detected():
    board = chess.Board(DISC_FEN)
    motifs = detect(board, DISC_MOVE)
    assert "discovered_attack" in _labels(motifs)


def test_motifs_sorted_by_confidence():
    board = chess.Board(FORK_FEN)
    motifs = detect(board, FORK_MOVE)
    confidences = [m.confidence for m in motifs]
    assert confidences == sorted(confidences, reverse=True)


# ── Mate Threat ───────────────────────────────────────────────────────────────
def test_mate_threat_detected():
    board = chess.Board()
    move = chess.Move.from_uci("e2e4")
    from analyse.motifs import _detect_mate_threat
    mate_score = chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE).white()
    result = EngineResult(
        best_move=move,
        lines=[Line(moves=[move], score=mate_score)],
        eval_before=mate_score,
        eval_after_best=mate_score,
    )
    motif = _detect_mate_threat(result)
    assert motif is not None
    assert motif.label == "mate_threat"
    assert "3" in motif.detail


# ── Hanging Piece ─────────────────────────────────────────────────────────────
HANG_FEN = "r1k5/8/8/8/8/8/8/R6K w - - 0 1"
HANG_MOVE = chess.Move.from_uci("h1g1")  # any quiet move; hanging detected on current board


def test_hanging_piece_detected():
    board = chess.Board(HANG_FEN)
    motifs = detect(board, HANG_MOVE)
    assert "hanging" in _labels(motifs)


def test_hanging_not_detected_when_defended():
    fen = "r7/k7/8/8/8/8/8/R6K w - - 0 1"  # Black Ra8, Black Ka7 defends a8
    board = chess.Board(fen)
    motifs = detect(board, chess.Move.from_uci("h1g1"))
    assert "hanging" not in _labels(motifs)


# ── Overloaded Defender ───────────────────────────────────────────────────────
# White Re4+Bc3 attack Nd4; White Re4+Bh2 attack Nf4; Black Qe3 defends both
OVERLOAD_FEN = "4k3/8/8/8/3nRn2/2B1q3/7B/7K w - - 0 1"
OVERLOAD_MOVE = chess.Move.from_uci("e4e5")  # any move; overload detected on current board


def test_overloaded_defender_detected():
    board = chess.Board(OVERLOAD_FEN)
    motifs = detect(board, OVERLOAD_MOVE)
    assert "overloaded" in _labels(motifs)


# ── Back Rank Weakness ────────────────────────────────────────────────────────
# Black Kg8, Nf8+Rh8 block f8/h8; pawns g7/h7 block g7/h7; White Ra1 on open a-file
BACK_RANK_FEN = "5nkr/6pp/8/8/8/8/8/R6K w - - 0 1"
BACK_RANK_MOVE = chess.Move.from_uci("a1a8")


def test_back_rank_weakness_detected():
    board = chess.Board(BACK_RANK_FEN)
    motifs = detect(board, BACK_RANK_MOVE)
    assert "back_rank" in _labels(motifs)

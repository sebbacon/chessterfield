import chess
import pytest
from analyse.motifs import detect, Motif

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

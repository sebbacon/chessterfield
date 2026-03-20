# Position Analyser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool (`python -m analyse`) that takes FEN or PGN, runs Stockfish, detects tactical motifs, and explains the position in natural language.

**Architecture:** Four focused modules (`parse`, `engine`, `motifs`, `explain`) wired by a thin CLI entry point in `analyse/__main__.py`. No Django dependency. Tests in `tests/analyse/`.

**Tech Stack:** `python-chess` (board/FEN/PGN/UCI), `chess.engine.SimpleEngine` (Stockfish UCI wrapper), `shutil.which` (binary discovery), `argparse` (CLI), `pytest` (tests)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `analyse/__init__.py` | Create | Empty package marker |
| `analyse/parse.py` | Create | FEN/PGN → `chess.Board` + last move |
| `analyse/engine.py` | Create | Stockfish wrapper → `EngineResult` |
| `analyse/motifs.py` | Create | Heuristic motif detection → `list[Motif]` |
| `analyse/explain.py` | Create | Engine + motifs → formatted string |
| `analyse/__main__.py` | Create | CLI entry point |
| `tests/analyse/__init__.py` | Create | Package marker for test discovery |
| `tests/analyse/test_parse.py` | Create | Tests for parse.py |
| `tests/analyse/test_engine.py` | Create | Tests for engine.py (mocked Stockfish) |
| `tests/analyse/test_motifs.py` | Create | Tests for motifs.py (known positions) |
| `tests/analyse/test_explain.py` | Create | Tests for explain.py (output format) |
| `justfile` | Modify | Add `analyse` recipe |

---

## Task 1: Scaffold + parse.py

**Files:**
- Create: `analyse/__init__.py`
- Create: `analyse/parse.py`
- Create: `tests/analyse/__init__.py`
- Create: `tests/analyse/test_parse.py`

- [ ] **Step 1: Create package directories and init files**

```bash
mkdir -p /Users/sebbacon/Code/Projects/chessterfield/analyse
mkdir -p /Users/sebbacon/Code/Projects/chessterfield/tests/analyse
touch /Users/sebbacon/Code/Projects/chessterfield/analyse/__init__.py
touch /Users/sebbacon/Code/Projects/chessterfield/tests/analyse/__init__.py
```

- [ ] **Step 2: Write failing tests**

Create `tests/analyse/test_parse.py`:

```python
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
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd /Users/sebbacon/Code/Projects/chessterfield && .venv/bin/python -m pytest tests/analyse/test_parse.py -v
```

Expected: `ModuleNotFoundError: No module named 'analyse.parse'`

- [ ] **Step 4: Implement parse.py**

Create `analyse/parse.py`:

```python
import io
import chess
import chess.pgn


def parse_input(text: str) -> tuple[chess.Board, chess.Move | None]:
    """Detect FEN vs PGN. Return (board, last_move_or_None)."""
    text = text.strip()

    # Try FEN first: FEN strings contain exactly one space-separated rank description
    # A quick heuristic: FEN has no newlines and contains '/'
    if "\n" not in text and "/" in text:
        try:
            board = chess.Board(text)
        except ValueError:
            raise ValueError(f"could not parse as FEN or PGN: {text!r}")
        if not board.is_valid():
            raise ValueError("illegal position")
        return board, None

    # Try PGN
    pgn_io = io.StringIO(text)
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        raise ValueError(f"could not parse as FEN or PGN: {text!r}")

    board = game.board()
    last_move = None
    for move in game.mainline_moves():
        last_move = move
        board.push(move)

    return board, last_move
```

- [ ] **Step 5: Run tests**

```bash
.venv/bin/python -m pytest tests/analyse/test_parse.py -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add analyse/ tests/analyse/
git commit -m "feat: add analyse package scaffold and parse.py"
```

---

## Task 2: engine.py

**Files:**
- Create: `analyse/engine.py`
- Create: `tests/analyse/test_engine.py`

- [ ] **Step 1: Write failing tests**

Create `tests/analyse/test_engine.py`:

```python
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
.venv/bin/python -m pytest tests/analyse/test_engine.py -v
```

Expected: `ModuleNotFoundError: No module named 'analyse.engine'`

- [ ] **Step 3: Implement engine.py**

Create `analyse/engine.py`:

```python
import shutil
from dataclasses import dataclass

import chess
import chess.engine


@dataclass
class Line:
    moves: list[chess.Move]
    score: chess.engine.Score  # from White's perspective


@dataclass
class EngineResult:
    best_move: chess.Move
    lines: list[Line]
    eval_before: chess.engine.Score   # White's perspective, root position
    eval_after_best: chess.engine.Score  # White's perspective, after best move


def analyse(board: chess.Board, num_lines: int = 5) -> EngineResult:
    """Run Stockfish and return top num_lines lines with evals."""
    path = shutil.which("stockfish")
    if path is None:
        raise RuntimeError(
            "stockfish binary not found. Install it: "
            "brew install stockfish (macOS) or apt install stockfish (Linux)"
        )

    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        # First call: get top N lines from root position
        infos = engine.analyse(
            board,
            chess.engine.Limit(depth=20),
            multipv=num_lines,
        )
        if not isinstance(infos, list):
            infos = [infos]

        eval_before = infos[0]["score"].white()
        best_move = infos[0]["pv"][0]

        lines = [
            Line(
                moves=info.get("pv", []),
                score=info["score"].white(),
            )
            for info in infos
        ]

        # Second call: eval after best move
        board_after = board.copy()
        board_after.push(best_move)
        info_after = engine.analyse(board_after, chess.engine.Limit(depth=20), multipv=1)
        if isinstance(info_after, list):
            info_after = info_after[0]
        eval_after_best = info_after["score"].white()

    return EngineResult(
        best_move=best_move,
        lines=lines,
        eval_before=eval_before,
        eval_after_best=eval_after_best,
    )
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/python -m pytest tests/analyse/test_engine.py -v
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add analyse/engine.py tests/analyse/test_engine.py
git commit -m "feat: add engine.py with Stockfish UCI wrapper"
```

---

## Task 3: motifs.py — fork, pin, skewer, discovered attack

**Files:**
- Create: `analyse/motifs.py` (partial — add remaining motifs in Task 4)
- Create: `tests/analyse/test_motifs.py` (partial)

- [ ] **Step 1: Write failing tests for the first four motifs**

Create `tests/analyse/test_motifs.py`:

```python
import chess
import pytest
from analyse.motifs import detect, Motif

# ── Fork ──────────────────────────────────────────────────────────────────────
# White Ne5 can go to f7, attacking Black Qd8 and Rh8
# FEN: White Kh1 Ne5, Black Ke8 Qd8 Rh8
FORK_FEN = "3qk2r/8/8/4N3/8/8/8/7K w - - 0 1"
FORK_MOVE = chess.Move.from_uci("e5f7")   # Nf7 attacks d8 (Q) and h8 (R)

# ── Pin ───────────────────────────────────────────────────────────────────────
# White Bg5 pins Black Nf6 to Black Ke8 — if Nf7 is played (putting Bg5 on the
# diagonal ke8-g6), Nf6 is pinned and cannot recapture
# White Kh1 Bg5, Black Ke8 Nf6 Qd8 — after Bg5 pins Nf6 to Qd8
# Simpler: White plays Re1 to e5; Nd5 is pinned to Ke8 via Re1 line
# Use: White Ra1 plays Ra8, forking — no. Let's use a direct pin position.
# White Bg2 pins Black Nf3 to Black Ke2 (diagonal). Best move Bg2 pins.
# Keep it simple: White Bb5 already on board, Black Nc6 pinned to Ke8
PIN_FEN = "r1bqk2r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
# After Bxc6 (captures Nc6), but we want a pin not a capture.
# Simpler pin: White plays Bb5, Nc6 is now pinned to Ke8
# Use the Ruy Lopez pin: after 1. e4 e5 2. Nf3 Nc6 3. Bb5, Nc6 is pinned
# Board: White Bb5 plays to f1-b5, Nc6 pinned to Ke8
# FEN after 3. Bb5:
PIN_FEN = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"
# Now if White plays Bb5xc6 (captures the pinned piece), that's a capture.
# For pin test: board where a piece IS pinned, and best_move goes to a square
# the pinned piece would normally recapture on.
# White Rc1 moves to c6, Nc6 would recapture but it's pinned to Ke8 by Bb5.
# FEN: White: Kh1 Rc1 Bb5, Black: Ke8 Nc6 Qd8
PIN_FEN = "3qk3/8/2n5/1B6/8/8/8/2R4K w - - 0 1"
PIN_MOVE = chess.Move.from_uci("c1c6")   # Rc6, Nc6 would recapture but is pinned to Ke8 by Bb5

# ── Skewer ────────────────────────────────────────────────────────────────────
# White Ra1 moves to b1 (Rb1), attacking Black Qb5 (queen, val=9) on the b-file.
# Behind Qb5 on the same file is Black Rb8 (rook, val=5) — classic skewer.
SKEWER_FEN = "1r6/8/8/1q6/8/8/8/Rk5K w - - 0 1"
SKEWER_MOVE = chess.Move.from_uci("a1b1")  # Rb1 attacks Qb5 (high), then Rb8 behind (lower)

# ── Discovered Attack ─────────────────────────────────────────────────────────
# White: Kh1, Ne5 (will move), Rg1 (reveals attack on g-file after N moves)
# Ne5 moves to f3, revealing Rg1's attack on g7 (Black Rg7)
DISC_FEN = "6kr/6r1/8/4N3/8/8/8/6RK w - - 0 1"
DISC_MOVE = chess.Move.from_uci("e5f3")  # Nf3, reveals Rg1 attacking Rg7


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
```

- [ ] **Step 2: Run to confirm fail**

```bash
.venv/bin/python -m pytest tests/analyse/test_motifs.py -v
```

Expected: `ModuleNotFoundError: No module named 'analyse.motifs'`

- [ ] **Step 3: Implement motifs.py with first four detectors**

Create `analyse/motifs.py`:

```python
from dataclasses import dataclass

import chess

PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,
}


def _piece_value(board: chess.Board, sq: chess.Square) -> int:
    piece = board.piece_at(sq)
    return PIECE_VALUES.get(piece.piece_type, 0) if piece else 0


def _san(board: chess.Board, move: chess.Move) -> str:
    try:
        return board.san(move)
    except Exception:
        return move.uci()


@dataclass
class Motif:
    label: str
    confidence: float
    detail: str


def _detect_fork(board: chess.Board, move: chess.Move) -> Motif | None:
    board_after = board.copy()
    board_after.push(move)
    enemy_color = board.turn  # board.turn before push = mover's color, enemy = not mover
    # after push, board_after.turn = enemy. enemy pieces are board_after.turn's pieces.
    enemy_color = board_after.turn

    attacked = board_after.attacks(move.to_square)
    targets = [
        sq for sq in attacked
        if board_after.color_at(sq) == enemy_color
        and _piece_value(board_after, sq) >= PIECE_VALUES[chess.KNIGHT]
    ]
    if len(targets) >= 2:
        sq1, sq2 = targets[0], targets[1]
        p1 = board_after.piece_at(sq1)
        p2 = board_after.piece_at(sq2)
        san = _san(board, move)
        detail = (
            f"{san} attacks {chess.square_name(sq1)} ({p1.symbol().upper()}) "
            f"and {chess.square_name(sq2)} ({p2.symbol().upper()})"
        )
        return Motif(label="fork", confidence=0.9, detail=detail)
    return None


def _detect_pin(board: chess.Board, move: chess.Move) -> Motif | None:
    board_after = board.copy()
    board_after.push(move)
    enemy_color = board_after.turn

    # Enemy pieces that attack the square the piece just moved to
    attackers = board_after.attackers(enemy_color, move.to_square)
    for sq in attackers:
        if board_after.is_pinned(enemy_color, sq):
            piece = board_after.piece_at(sq)
            detail = f"{piece.symbol().upper()} on {chess.square_name(sq)} is pinned and cannot recapture"
            return Motif(label="pin", confidence=0.9, detail=detail)
    return None


def _detect_skewer(board: chess.Board, move: chess.Move) -> Motif | None:
    board_after = board.copy()
    board_after.push(move)
    enemy_color = board_after.turn
    from_sq = move.to_square  # piece is now here

    for attacked_sq in board_after.attacks(from_sq):
        if board_after.color_at(attacked_sq) != enemy_color:
            continue
        attacked_val = _piece_value(board_after, attacked_sq)

        # Find squares on the ray beyond attacked_sq
        ray_bb = chess.BB_RAYS[from_sq][attacked_sq]
        # Squares beyond attacked_sq: on the ray, further from from_sq
        # The ray goes through both squares; we want squares past attacked_sq
        # Compute: squares on ray that are NOT between from_sq and attacked_sq
        between_bb = chess.BB_BETWEEN[from_sq][attacked_sq]
        beyond_bb = ray_bb & ~between_bb & ~chess.BB_SQUARES[from_sq] & ~chess.BB_SQUARES[attacked_sq]

        for behind_sq in chess.SquareSet(beyond_bb):
            if board_after.piece_at(behind_sq) is None:
                continue
            if board_after.color_at(behind_sq) != enemy_color:
                break  # own piece blocks the ray
            behind_val = _piece_value(board_after, behind_sq)
            if attacked_val > behind_val:
                p_high = board_after.piece_at(attacked_sq)
                p_low = board_after.piece_at(behind_sq)
                detail = (
                    f"Attacks {p_high.symbol().upper()} on {chess.square_name(attacked_sq)}, "
                    f"skewering {p_low.symbol().upper()} on {chess.square_name(behind_sq)}"
                )
                return Motif(label="skewer", confidence=0.85, detail=detail)
            break  # first piece on ray blocks further skewers

    return None


def _detect_discovered_attack(board: chess.Board, move: chess.Move) -> Motif | None:
    our_color = board.turn
    enemy_color = not our_color

    # Attackers of each enemy piece before the move
    before = {
        sq: set(board.attackers(our_color, sq))
        for sq in chess.SquareSet(board.occupied_co[enemy_color])
    }

    board_after = board.copy()
    board_after.push(move)

    # Attackers after the move — new attackers that are NOT the moved piece
    for sq in chess.SquareSet(board_after.occupied_co[enemy_color]):
        after_attackers = set(board_after.attackers(our_color, sq))
        prev_attackers = before.get(sq, set())
        new_attackers = after_attackers - prev_attackers - {move.to_square}
        for attacker_sq in new_attackers:
            attacker = board_after.piece_at(attacker_sq)
            target = board_after.piece_at(sq)
            if attacker and target:
                moved_piece = board_after.piece_at(move.to_square)
                moved_sym = moved_piece.symbol().upper() if moved_piece else "?"
                detail = (
                    f"Moving {moved_sym} reveals attack by "
                    f"{attacker.symbol().upper()} on {chess.square_name(sq)}"
                )
                return Motif(label="discovered_attack", confidence=0.85, detail=detail)
    return None


def detect(board: chess.Board, best_move: chess.Move) -> list[Motif]:
    """Return detected motifs sorted by confidence descending."""
    detectors = [
        _detect_fork,
        _detect_pin,
        _detect_skewer,
        _detect_discovered_attack,
    ]
    motifs = [m for d in detectors if (m := d(board, best_move)) is not None]
    return sorted(motifs, key=lambda m: m.confidence, reverse=True)
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/python -m pytest tests/analyse/test_motifs.py -v
```

Expected: 6 tests PASS. The Task 3 test file only contains tests for fork/pin/skewer/discovered_attack/sort — the remaining four detectors are added in Task 4.

- [ ] **Step 5: Commit**

```bash
git add analyse/motifs.py tests/analyse/test_motifs.py
git commit -m "feat: add motifs.py with fork, pin, skewer, discovered attack"
```

---

## Task 4: motifs.py — mate threat, hanging piece, overloaded defender, back rank weakness

**Files:**
- Modify: `analyse/motifs.py`
- Modify: `tests/analyse/test_motifs.py`

- [ ] **Step 1: Write failing tests for the remaining four motifs**

First, add these two imports at the **top** of `tests/analyse/test_motifs.py` (after the existing imports):

```python
import chess.engine
from analyse.engine import EngineResult, Line
```

Then append the following test functions to the **bottom** of `tests/analyse/test_motifs.py`:

```python

# ── Mate Threat ───────────────────────────────────────────────────────────────
def test_mate_threat_detected():
    board = chess.Board()
    move = chess.Move.from_uci("e2e4")
    # Inject a mock EngineResult with a Mate score
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
# Black Qd5 is attacked by White Re5 (or similar) with no defenders
# FEN: White Kh1 Re1, Black Kc8 Qd5 — White to move. Qd5 attacked by Re1 via e-file? No.
# Simpler: White Ra5 attacks Black Qa5 (on a5)... no same square.
# White Ra4 attacks Black Qa5 (not on a-file).
# Use: White Ra1 attacks Black Ra8 (on a-file) — Ra8 defended? No defenders.
# FEN: White Kh1 Ra1, Black Ka8... Ka8 is king, use rook.
# White: Kh1 Ra1. Black: Kc8 Ra8 — Ra8 is on a-file, Ra1 attacks it, no Black defender of a8.
HANG_FEN = "r1k5/8/8/8/8/8/8/R6K w - - 0 1"
HANG_MOVE = chess.Move.from_uci("h1g1")  # any quiet move; hanging detected on current board


def test_hanging_piece_detected():
    board = chess.Board(HANG_FEN)
    motifs = detect(board, HANG_MOVE)
    assert "hanging" in _labels(motifs)


def test_hanging_not_detected_when_defended():
    # Black Ra8 defended by Black Ka8 (king defends) — wait, king can't defend on a8 if Ra8 is there.
    # Use: Black Ra8 defended by Black Rd8
    # FEN: White Kh1 Ra1, Black Ka8... use a position where piece IS defended.
    # White Ra1 attacks Black Ra8, but Black Rd8 defends a8? No, Rd8 defends d8 not a8.
    # White Ra1 attacks Black Ra8, Black Ka7 defends a8? Ka7 can move to a8.
    # chess.Board.attackers counts king as a defender if it controls the square.
    fen = "r7/k7/8/8/8/8/8/R6K w - - 0 1"  # Black Ra8, Black Ka7 defends a8
    board = chess.Board(fen)
    motifs = detect(board, chess.Move.from_uci("h1g1"))
    assert "hanging" not in _labels(motifs)


# ── Overloaded Defender ───────────────────────────────────────────────────────
# Black Rd7 defends both Black Nd4 and Black Bd6 — both attacked by White
# FEN: White Kh1 Re4 Bb3, Black Ke8 Rd7 Nd4 Bd6
OVERLOAD_FEN = "4k3/3r4/3b4/8/3n4/1B6/8/4R2K w - - 0 1"
OVERLOAD_MOVE = chess.Move.from_uci("e1e4")  # Re4 attacks Nd4, Bb3 already attacks Bd6 (via diagonal?)


def test_overloaded_defender_detected():
    board = chess.Board(OVERLOAD_FEN)
    motifs = detect(board, OVERLOAD_MOVE)
    assert "overloaded" in _labels(motifs)


# ── Back Rank Weakness ────────────────────────────────────────────────────────
# Black king on g8 trapped behind pawns f7 g7 h7, White has Ra1 with open a-file to 8th rank
BACK_RANK_FEN = "6k1/5ppp/8/8/8/8/8/R6K w - - 0 1"
BACK_RANK_MOVE = chess.Move.from_uci("a1a8")  # Ra8# would be mate but detect checks the position


def test_back_rank_weakness_detected():
    board = chess.Board(BACK_RANK_FEN)
    motifs = detect(board, BACK_RANK_MOVE)
    assert "back_rank" in _labels(motifs)
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
.venv/bin/python -m pytest tests/analyse/test_motifs.py -v -k "mate_threat or hanging or overloaded or back_rank"
```

Expected: FAIL — `ImportError` or `AssertionError`

- [ ] **Step 3: Add remaining detectors to motifs.py**

Add to `analyse/motifs.py` (after the existing detectors, before `detect()`):

```python
from analyse.engine import EngineResult  # add this import at top of file


def _detect_mate_threat(result: "EngineResult") -> "Motif | None":
    score = result.lines[0].score
    if score.is_mate():
        n = score.mate()
        if n is not None and n > 0:
            return Motif(label="mate_threat", confidence=1.0, detail=f"Forced mate in {n}")
    return None


def _detect_hanging(board: chess.Board, move: chess.Move) -> Motif | None:
    our_color = board.turn
    enemy_color = not our_color

    for sq in chess.SquareSet(board.occupied_co[enemy_color]):
        piece = board.piece_at(sq)
        if piece is None or piece.piece_type == chess.KING:
            continue
        attackers_count = len(board.attackers(our_color, sq))
        defenders_count = len(board.attackers(enemy_color, sq))
        if attackers_count == 0:
            continue
        if defenders_count == 0:
            detail = (
                f"{piece.symbol().upper()} on {chess.square_name(sq)} is undefended "
                f"({defenders_count} defenders, {attackers_count} attackers)"
            )
            return Motif(label="hanging", confidence=0.8, detail=detail)
        # Attacked by lower-value piece and defenders ≤ attackers
        attacker_values = sorted(
            _piece_value(board, a) for a in board.attackers(our_color, sq)
        )
        piece_val = _piece_value(board, sq)
        if attacker_values and attacker_values[0] < piece_val and defenders_count <= attackers_count:
            detail = (
                f"{piece.symbol().upper()} on {chess.square_name(sq)} is undefended "
                f"({defenders_count} defenders, {attackers_count} attackers)"
            )
            return Motif(label="hanging", confidence=0.8, detail=detail)
    return None


def _detect_overloaded(board: chess.Board, move: chess.Move) -> Motif | None:
    our_color = board.turn
    enemy_color = not our_color

    for def_sq in chess.SquareSet(board.occupied_co[enemy_color]):
        defender = board.piece_at(def_sq)
        if defender is None:
            continue
        # squares the defender attacks
        defended_squares = board.attacks(def_sq)
        # enemy pieces on those squares that we also attack
        attacked_defended = [
            sq for sq in defended_squares
            if board.color_at(sq) == enemy_color
            and board.piece_at(sq) is not None
            and board.piece_at(sq).piece_type != chess.KING
            and len(board.attackers(our_color, sq)) > 0
        ]
        if len(attacked_defended) >= 2:
            p1_sq, p2_sq = attacked_defended[0], attacked_defended[1]
            p1 = board.piece_at(p1_sq)
            p2 = board.piece_at(p2_sq)
            detail = (
                f"{defender.symbol().upper()} on {chess.square_name(def_sq)} defends both "
                f"{p1.symbol().upper()} on {chess.square_name(p1_sq)} and "
                f"{p2.symbol().upper()} on {chess.square_name(p2_sq)} but cannot protect both"
            )
            return Motif(label="overloaded", confidence=0.75, detail=detail)
    return None


def _detect_back_rank(board: chess.Board, move: chess.Move) -> Motif | None:
    our_color = board.turn
    enemy_color = not our_color

    enemy_king_sq = board.king(enemy_color)
    if enemy_king_sq is None:
        return None

    back_rank = chess.BB_RANK_8 if enemy_color == chess.BLACK else chess.BB_RANK_1
    if not (chess.BB_SQUARES[enemy_king_sq] & back_rank):
        return None

    # Check if king escape squares on the back rank are blocked by own pawns
    king_attacks = board.attacks(enemy_king_sq)
    back_rank_escapes = chess.SquareSet(king_attacks & back_rank)
    own_pawns = board.pieces(chess.PAWN, enemy_color)
    if not all(sq in own_pawns or board.piece_at(sq) is not None for sq in back_rank_escapes):
        return None

    # Do we have a rook or queen that can reach the back rank?
    for sq in board.pieces(chess.ROOK, our_color) | board.pieces(chess.QUEEN, our_color):
        if chess.BB_SQUARES[sq] & back_rank:
            # Already on back rank
            king_sq_name = chess.square_name(enemy_king_sq)
            return Motif(
                label="back_rank",
                confidence=0.8,
                detail=f"Enemy king on {king_sq_name} is trapped on the back rank",
            )
        # Check file/rank line of sight to back rank
        rank = chess.square_rank(enemy_king_sq)
        file_ = chess.square_file(sq)
        target_sq = chess.square(file_, rank)
        if not (board.occupied & chess.BB_BETWEEN[sq][target_sq]):
            king_sq_name = chess.square_name(enemy_king_sq)
            return Motif(
                label="back_rank",
                confidence=0.8,
                detail=f"Enemy king on {king_sq_name} is trapped on the back rank",
            )
    return None
```

Also update the `detect()` function to include the new detectors and accept `result`:

```python
def detect(
    board: chess.Board,
    best_move: chess.Move,
    result: "EngineResult | None" = None,
) -> list[Motif]:
    """Return detected motifs sorted by confidence descending."""
    motifs = []
    for detector in [_detect_fork, _detect_pin, _detect_skewer, _detect_discovered_attack]:
        m = detector(board, best_move)
        if m:
            motifs.append(m)
    for detector in [_detect_hanging, _detect_overloaded, _detect_back_rank]:
        m = detector(board, best_move)
        if m:
            motifs.append(m)
    if result is not None:
        m = _detect_mate_threat(result)
        if m:
            motifs.append(m)
    return sorted(motifs, key=lambda m: m.confidence, reverse=True)
```

Also add `from __future__ import annotations` at the top of `motifs.py` to handle forward refs.

- [ ] **Step 4: Run all motif tests**

```bash
.venv/bin/python -m pytest tests/analyse/test_motifs.py -v
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add analyse/motifs.py tests/analyse/test_motifs.py
git commit -m "feat: add remaining motif detectors (mate, hanging, overloaded, back rank)"
```

---

## Task 5: explain.py

**Files:**
- Create: `analyse/explain.py`
- Create: `tests/analyse/test_explain.py`

- [ ] **Step 1: Write failing tests**

Create `tests/analyse/test_explain.py`:

```python
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
```

- [ ] **Step 2: Run to confirm fail**

```bash
.venv/bin/python -m pytest tests/analyse/test_explain.py -v
```

Expected: `ModuleNotFoundError: No module named 'analyse.explain'`

- [ ] **Step 3: Implement explain.py**

Create `analyse/explain.py`:

```python
from __future__ import annotations

import chess
import chess.engine

from analyse.engine import EngineResult, Line
from analyse.motifs import Motif


def _format_score(score: chess.engine.Score) -> str:
    if score.is_mate():
        n = score.mate()
        if n is None:
            return "#?"
        return f"#{n}" if n > 0 else f"#-{abs(n)}"
    cp = score.score()
    if cp is None:
        return "?"
    return f"{cp / 100:+.2f}"


def _format_pv(board: chess.Board, moves: list[chess.Move]) -> str:
    """Format up to 6 half-moves as SAN with move numbers."""
    board_copy = board.copy()
    parts = []
    first = True
    for i, move in enumerate(moves[:6]):
        if board_copy.turn == chess.WHITE or first:
            num = board_copy.fullmove_number
            if board_copy.turn == chess.WHITE:
                parts.append(f"{num}.")
            else:
                parts.append(f"{num}...")
            first = False
        try:
            san = board_copy.san(move)
        except Exception:
            san = move.uci()
        parts.append(san)
        board_copy.push(move)
    return " ".join(parts)


def explain(board: chess.Board, result: EngineResult, motifs: list[Motif]) -> str:
    side = "White" if board.turn == chess.WHITE else "Black"
    eval_str = _format_score(result.eval_before)

    # Best move SAN
    try:
        best_san = board.san(result.best_move)
    except Exception:
        best_san = result.best_move.uci()

    after_str = _format_score(result.eval_after_best)

    # Delta: both scores already in White's POV
    before_cp = result.eval_before.score(mate_score=10000)
    after_cp = result.eval_after_best.score(mate_score=10000)
    if before_cp is not None and after_cp is not None:
        delta = (after_cp - before_cp) / 100
        delta_str = f"({delta:+.2f})"
    else:
        delta_str = ""

    lines_out = []
    for i, line in enumerate(result.lines):
        if not line.moves:
            continue
        try:
            first_san = board.san(line.moves[0])
        except Exception:
            first_san = line.moves[0].uci()
        score_str = _format_score(line.score)
        pv_str = _format_pv(board, line.moves)
        lines_out.append(f"  {i + 1}. {first_san:<8} {score_str:<8} {pv_str}")

    visible_motifs = [m for m in motifs if m.confidence >= 0.5]

    parts = [
        f"Position: {side} to move  Eval: {eval_str}",
        f"Best move: {best_san}  → Eval: {after_str}  {delta_str}".strip(),
        "",
        "Candidates:",
    ]
    parts.extend(lines_out)
    parts.append("")
    parts.append("Motifs:")
    if visible_motifs:
        for m in visible_motifs:
            parts.append(f"  [{m.label} {m.confidence:.2f}]  {m.detail}")
    else:
        parts.append("  (none detected)")

    return "\n".join(parts)
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/python -m pytest tests/analyse/test_explain.py -v
```

Expected: all PASS

- [ ] **Step 5: Run full suite to check for regressions**

```bash
.venv/bin/python -m pytest -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add analyse/explain.py tests/analyse/test_explain.py
git commit -m "feat: add explain.py formatter"
```

---

## Task 6: __main__.py + justfile

**Files:**
- Create: `analyse/__main__.py`
- Modify: `justfile`

- [ ] **Step 1: Implement __main__.py**

Create `analyse/__main__.py`:

```python
from __future__ import annotations

import argparse
import sys

from analyse.parse import parse_input
from analyse.engine import analyse
from analyse.motifs import detect
from analyse.explain import explain


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m analyse",
        description="Analyse a chess position with Stockfish and motif detection.",
    )
    parser.add_argument("fen", nargs="?", help='FEN string, or "-" to read from stdin')
    parser.add_argument("--pgn", metavar="FILE", help="PGN file to read")
    parser.add_argument("--lines", type=int, default=5, metavar="N", help="Number of candidate lines (default 5)")
    args = parser.parse_args(argv)

    if args.fen and args.pgn:
        print("Error: cannot specify both FEN and --pgn", file=sys.stderr)
        return 1

    if args.pgn:
        try:
            with open(args.pgn) as f:
                text = f.read()
        except OSError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
    elif args.fen == "-":
        text = sys.stdin.read()
        if not text.strip():
            print("Error: no input on stdin", file=sys.stderr)
            return 1
    elif args.fen:
        text = args.fen
    else:
        parser.print_help()
        return 1

    try:
        board, _last_move = parse_input(text)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    try:
        result = analyse(board, num_lines=args.lines)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    motifs = detect(board, result.best_move, result)
    print(explain(board, result, motifs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Test basic CLI invocation (no Stockfish needed — just parse errors)**

```bash
cd /Users/sebbacon/Code/Projects/chessterfield && .venv/bin/python -m analyse --help
```

Expected: usage printed

```bash
.venv/bin/python -m analyse "not valid" 2>&1; echo "exit: $?"
```

Expected: `Error: could not parse as FEN or PGN ...` and `exit: 1`

```bash
echo "" | .venv/bin/python -m analyse - 2>&1; echo "exit: $?"
```

Expected: `Error: no input on stdin` and `exit: 1`

- [ ] **Step 3: Add justfile recipe**

Append to `justfile`:

```just
# Analyse a chess position (requires: brew install stockfish)
# Usage: just analyse "FEN" | just analyse --pgn game.pgn
analyse *args:
    .venv/bin/python -m analyse {{args}}
```

- [ ] **Step 4: Verify recipe appears**

```bash
just --list
```

Expected: `analyse` in list

- [ ] **Step 5: Run full test suite**

```bash
.venv/bin/python -m pytest -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add analyse/__main__.py justfile
git commit -m "feat: add CLI entry point and justfile recipe"
```

---

## Task 7: Smoke test (manual, requires stockfish installed)

- [ ] **Step 1: Check stockfish is available**

```bash
which stockfish || echo "NOT FOUND — install with: brew install stockfish"
```

- [ ] **Step 2: Run on starting position**

```bash
just analyse "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
```

Expected: output with Position, Best move, Candidates, Motifs sections

- [ ] **Step 3: Run on a known tactical position (knight fork)**

```bash
just analyse "3qk2r/8/8/4N3/8/8/8/7K w - - 0 1"
```

Expected: `fork` appears in Motifs

- [ ] **Step 4: Run with --lines 3**

```bash
just analyse --lines 3 "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
```

Expected: 3 candidates shown

# Position Analyser — Design Spec

**Date:** 2026-03-20

## Overview

A standalone CLI tool (`python -m analyse`) that takes a FEN string or PGN file, runs Stockfish analysis, detects tactical motifs with heuristics, and produces a natural-language explanation tied to concrete board facts.

No Django dependency. Lives in `analyse/` at the project root.

## Architecture

Four focused submodules wired together by a thin CLI entry point.

```
analyse/
  __init__.py
  __main__.py   # CLI: parses args, wires components, prints output
  parse.py      # FEN string or PGN text → chess.Board + optional last move
  engine.py     # Stockfish wrapper → top N lines, centipawn/mate evals
  motifs.py     # Heuristics → list of Motif(label, confidence, detail)
  explain.py    # Engine result + motifs → human-readable text
tests/analyse/
  __init__.py
  test_parse.py
  test_engine.py
  test_motifs.py
  test_explain.py
```

## Interfaces

### parse.py

```python
def parse_input(text: str) -> tuple[chess.Board, chess.Move | None]:
    """Detect FEN vs PGN, return board at that position and last move played (or None)."""
```

- If `text` is a valid FEN string: load directly, `last_move = None`
- If `text` looks like PGN: parse with `chess.pgn`, return board at final position and final move
- Raises `ValueError` with a clear message on unrecognised input

### engine.py

```python
@dataclass
class Line:
    moves: list[chess.Move]
    score: chess.engine.Score   # centipawns or Mate

@dataclass
class EngineResult:
    best_move: chess.Move
    lines: list[Line]           # top N lines
    eval_before: chess.engine.Score   # root position score (from side to move)
    eval_after_best: chess.engine.Score  # position score after best move (from side to move)

def analyse(board: chess.Board, num_lines: int = 5) -> EngineResult:
    """Run Stockfish and return top N lines with evals."""
```

**Score convention:** all `chess.engine.Score` values are from the perspective of the **side to move** in the position being evaluated. Positive = good for side to move.

**Implementation:**
1. Call `engine.analyse(board, chess.engine.Limit(depth=20), multipv=num_lines)` to get `num_lines` candidate lines. `eval_before` = `info[0]["score"].relative` (top line score = root eval, side to move).
2. Push `best_move` onto a copy of `board`, call `engine.analyse()` again with `multipv=1`. `eval_after_best` = `info[0]["score"].relative` (from the *new* side to move, i.e. the opponent's perspective).

Uses `chess.engine.SimpleEngine.popen_uci(path)` where `path = shutil.which("stockfish")`. If `path` is `None`, raises `RuntimeError` with the message: `"stockfish binary not found. Install it: brew install stockfish (macOS) or apt install stockfish (Linux)"`.

### motifs.py

```python
@dataclass
class Motif:
    label: str          # "fork", "pin", etc.
    confidence: float   # 0.0–1.0
    detail: str         # e.g. "Nf6+ attacks Kg8 and Qd7 simultaneously"

def detect(board: chess.Board, best_move: chess.Move) -> list[Motif]:
    """Return detected motifs sorted by confidence descending."""
```

Detection uses python-chess only. No engine call. See heuristics section below.

### explain.py

```python
def explain(board: chess.Board, result: EngineResult, motifs: list[Motif]) -> str:
    """Format engine result and motifs into human-readable output."""
```

**Output construction rules:**

- **Line 1:** `Position: {White|Black} to move  Eval: {score}`
  - Score formatted as `+N.NN` / `-N.NN` / `#N` from White's perspective (negate `eval_before` if Black to move)
- **Line 2:** `Best move: {san}  → Eval: {after_score}  ({delta})`
  - `{delta}` = `eval_after_best` converted to White's perspective minus `eval_before` converted to White's perspective, shown as `(+N.NN)` or `(-N.NN)`
- **Blank line**
- **`Candidates:` block:** one line per `Line` in `result.lines`:
  - `  {rank}. {san_of_first_move}   {score}  {pv_in_san}` where pv is first 4 half-moves joined by spaces with move numbers (e.g. `1. Nf6+ Kg8 2. Nxd7`)
- **Blank line**
- **`Motifs:` block:** one line per motif with confidence ≥ 0.5:
  - `  [{label} {confidence:.2f}]  {detail}`
- If no motifs ≥ 0.5: print `  (none detected)`

### __main__.py

```
usage: python -m analyse [-h] [--pgn FILE] [--lines N] [FEN | -]
```

- Positional arg: FEN string, or `-` for stdin
- `--pgn FILE`: read PGN from file
- `--lines N`: number of candidate lines (default 5, must match `analyse()` default)
- If both a positional FEN and `--pgn` are provided: `Error: cannot specify both FEN and --pgn\n` + exit 1

Flow: `parse_input` → `engine.analyse` → `motifs.detect` → `explain.explain` → print

## Motif Detection Heuristics

### Fork (confidence 0.9)

After simulating `best_move` on a board copy:
- Get all squares attacked by the piece that just moved (`board.attacks(best_move.to_square)`)
- Filter to enemy pieces worth ≥ knight (knight=3, bishop=3, rook=5, queen=9, king=∞)
- If 2+ such squares: fork detected
- `detail`: `"{san} attacks {sq1} ({piece1}) and {sq2} ({piece2})"`

### Pin (confidence 0.9)

On the current board (before simulating best_move):
- For each enemy piece that could legally recapture on `best_move.to_square`:
  - Check `board.is_pinned(enemy_color, recapture_square)` — if True, that defender is pinned
- If any pinned recapturer found: pin detected (the best move exploits the pin)
- `detail`: `"{piece} on {sq} is pinned and cannot recapture"`

### Skewer (confidence 0.85)

After simulating `best_move`:
- Get rays from `best_move.to_square` in all 8 directions using `chess.ray(from_sq, to_sq)`
- For each ray, find the first enemy piece hit (`attacked_sq`) and the next piece on the same ray (`behind_sq`)
- If `piece_value(attacked_sq) > piece_value(behind_sq)` and `behind_sq` is also an enemy piece: skewer detected
- `detail`: `"Attacks {high-value piece} on {sq}, skewering {lower piece} on {sq2}"`

### Discovered Attack (confidence 0.85)

Compare attackers before and after simulating `best_move`:
- For each enemy piece on the board: compute `board.attackers(our_color, enemy_sq)` before and after the move
- If a new attacker appears that was *not* the moved piece (i.e. a piece on the ray behind `best_move.from_square`): discovered attack detected
- `detail`: `"Moving {piece} reveals attack by {piece2} on {target}"`

### Mate Threat (confidence 1.0)

- If `result.lines[0].score` is `Mate(n)` for any n > 0: mate threat detected
- `detail`: `"Forced mate in {n}"`

### Hanging Piece (confidence 0.8)

On the current board:
- For each enemy piece at `sq`:
  - `attackers = len(board.attackers(our_color, sq))`
  - `defenders = len(board.attackers(enemy_color, sq))`
  - Piece is hanging if `attackers > 0` and `defenders == 0`, OR if least-value attacker < piece value and defenders ≤ attackers
- `detail`: `"{piece} on {sq} is undefended ({defenders} defenders, {attackers} attackers)"`

### Overloaded Defender (confidence 0.75)

On the current board:
- For each enemy piece at `def_sq`: find all enemy pieces it defends (`board.attacks(def_sq)` intersected with enemy piece squares)
- For each defended piece `p`, check if it is also attacked by us (`board.attackers(our_color, p) > 0`)
- If the same defender defends 2+ attacked pieces: overloaded
- `detail`: `"{piece} on {sq} defends both {p1} and {p2} but cannot protect both"`

### Back Rank Weakness (confidence 0.8)

On the current board:
- Identify enemy king's square; check if it is on rank 1 (White) or rank 8 (Black)
- Check if all squares on the king's rank adjacent to the king are occupied by own pawns (no escape)
- Check if we have a rook or queen with line of sight to the back rank
- If all three: back rank weakness detected
- `detail`: `"Enemy king on {sq} is trapped on the back rank"`

## Output Format

```
Position: White to move  Eval: +0.8
Best move: Nf6+  → Eval: +2.1  (+1.3)

Candidates:
  1. Nf6+   +2.1  1. Nf6+ Kg8 2. Nxd7
  2. Rxd7   +1.4  1. Rxd7 Nxd7 2. Bxf6
  3. Bxh7+  +0.9  1. Bxh7+ Kxh7 2. Qh5+

Motifs:
  [fork 0.95]     Nf6+ attacks Kg8 and Qd7 simultaneously
  [hanging 0.80]  Bishop on c5 is undefended (0 defenders, 1 attacker)
```

Scores always from White's perspective: `+N.NN` = White advantage, `-N.NN` = Black advantage, `#N` = mate in N (positive = White mates).

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| Unrecognised input | `Error: could not parse as FEN or PGN\n` + exit 1 |
| Stockfish not installed | `Error: stockfish binary not found. Install it: brew install stockfish (macOS) or apt install stockfish (Linux)\n` + exit 1 |
| Illegal position | `Error: illegal position\n` + exit 1 |
| Stdin `-` with no data | `Error: no input on stdin\n` + exit 1 |
| Both FEN and --pgn given | `Error: cannot specify both FEN and --pgn\n` + exit 1 |

## Dependencies

- `python-chess` (already in requirements.txt) — board, move generation, UCI engine wrapper, heuristics
- No additional pip package needed. Stockfish binary located via `shutil.which("stockfish")`.

Users must have `stockfish` installed as a system binary (`brew install stockfish` / `apt install stockfish`).

## Justfile Recipe

```just
# Analyse a chess position (requires: brew install stockfish)
# Usage: just analyse "FEN" | just analyse --pgn game.pgn
analyse *args:
    .venv/bin/python -m analyse {{args}}
```

## Testing Strategy

Tests live in `tests/analyse/`. The existing `pytest.ini` at the project root discovers `tests/` automatically; add `tests/analyse/__init__.py` to make it a package.

- **test_parse.py** — FEN/PGN round-trips, invalid input raises `ValueError`, both return correct board state
- **test_motifs.py** — known tactical positions for each motif (e.g. classic Knight fork → `fork` detected, Légall's Mate setup → `pin` detected); also verify no false positives on quiet positions
- **test_engine.py** — mock `chess.engine.SimpleEngine.popen_uci`, verify `EngineResult` structure, score parsing, and that a second engine call is made for `eval_after_best`
- **test_explain.py** — string-contains tests: given a known `EngineResult` and `list[Motif]`, verify output contains expected lines; verify motifs below 0.5 confidence are omitted

## What Is Not In Scope

- Opening book lookup
- Endgame tablebase queries
- Interactive game replay
- Web API or Django integration
- Storing results in the database

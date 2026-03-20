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
    eval_before: chess.engine.Score
    eval_after_best: chess.engine.Score

def analyse(board: chess.Board, num_lines: int = 5) -> EngineResult:
    """Run Stockfish and return top N lines with evals."""
```

Uses the `stockfish` pip package. Raises `RuntimeError` with install hint if binary not found.

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

Detection uses python-chess only (`attackers()`, `is_pinned()`, move simulation). No engine call.

### explain.py

```python
def explain(board: chess.Board, result: EngineResult, motifs: list[Motif]) -> str:
    """Format engine result and motifs into human-readable output."""
```

### __main__.py

```
usage: python -m analyse [-h] [--pgn FILE] [--lines N] [FEN | -]
```

- Positional arg: FEN string, or `-` for stdin
- `--pgn FILE`: read PGN from file
- `--lines N`: number of candidate lines (default 5)

## Motif Detection Heuristics

| Motif | Detection logic |
|-------|----------------|
| **Fork** | After simulating best_move: moving piece attacks 2+ enemy pieces worth ≥ knight |
| **Pin** | A piece is on a ray between an attacker and a more-valuable piece; `board.is_pinned()` |
| **Skewer** | A high-value piece is attacked on a ray; a lower-value piece sits behind it on the same ray |
| **Discovered attack** | Moving a piece reveals a ray attack from a piece behind it (check `attackers()` before/after) |
| **Mate threat** | Engine score is `Mate` in N moves |
| **Hanging piece** | An attacked piece has more attackers than defenders, or is attacked by a lower-value piece with no legal recapture |
| **Overloaded defender** | A single piece defends 2+ attacked enemy pieces — capturing one forces it to abandon another |
| **Back rank weakness** | King on rank 1 or 8 with all escape squares on that rank blocked by own pawns, and an enemy rook/queen on an open file |

## Output Format

```
Position: White to move  Eval: +0.8
Best move: Nf6+  → Eval: +2.1  (+1.3)

Candidates:
  1. Nf6+   +2.1  e4 Nf6+ Kg8 Nxd7
  2. Rxd7   +1.4  Rxd7 Nxd7 Bxf6
  3. Bxh7+  +0.9  Bxh7+ Kxh7 Qh5+

Motifs:
  [fork 0.95]     Nf6+ attacks Kg8 and Qd7 simultaneously
  [hanging 0.80]  Bishop on c5 is undefended (0 defenders, 1 attacker)
```

Scores displayed as `+N.NN` (White advantage) / `-N.NN` (Black advantage) / `#N` (mate in N).

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| Unrecognised input | `Error: could not parse as FEN or PGN\n` + exit 1 |
| Stockfish not installed | `Error: stockfish binary not found. Install: pip install stockfish\n` + exit 1 |
| Illegal position | `Error: illegal position\n` + exit 1 |
| Stdin `-` with no data | `Error: no input on stdin\n` + exit 1 |

## Dependencies

- `python-chess` (already in requirements.txt) — board, move generation, heuristics
- `stockfish` pip package — Stockfish binary management and UCI wrapper

Add `stockfish` to `requirements.txt`.

## Justfile Recipe

```just
# Analyse a chess position (FEN or --pgn FILE)
analyse *args:
    .venv/bin/python -m analyse {{args}}
```

## Testing Strategy

- **test_parse.py** — FEN/PGN round-trips, invalid input raises `ValueError`
- **test_motifs.py** — known tactical positions for each motif; e.g. classic Knight fork position detects `fork`, Legall's Mate setup detects `pin`
- **test_engine.py** — mock `stockfish.Stockfish`, verify `EngineResult` structure and score parsing
- **test_explain.py** — snapshot/string-contains tests for output format with known inputs

## What Is Not In Scope

- Opening book lookup
- Endgame tablebase queries
- Interactive game replay
- Web API or Django integration
- Storing results in the database

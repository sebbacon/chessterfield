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

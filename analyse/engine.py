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
            chess.engine.Limit(depth=20, time=5.0),
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
        info_after = engine.analyse(board_after, chess.engine.Limit(depth=20, time=5.0), multipv=1)
        if isinstance(info_after, list):
            info_after = info_after[0]
        eval_after_best = info_after["score"].white()

    return EngineResult(
        best_move=best_move,
        lines=lines,
        eval_before=eval_before,
        eval_after_best=eval_after_best,
    )

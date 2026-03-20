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

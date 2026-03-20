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

    # Validate that it looks like actual PGN (has brackets or move-like content)
    # chess.pgn.read_game is very permissive and will parse anything, so we need
    # to check that the input contains PGN-like markers
    if not any(c in text for c in ['[', '1.', '.']):
        raise ValueError(f"could not parse as FEN or PGN: {text!r}")

    board = game.board()
    last_move = None
    for move in game.mainline_moves():
        last_move = move
        board.push(move)

    return board, last_move

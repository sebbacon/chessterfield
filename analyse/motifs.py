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
        between_bb = chess.between(from_sq, attacked_sq)
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

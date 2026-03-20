from __future__ import annotations

from dataclasses import dataclass

import chess
from analyse.engine import EngineResult

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


def _detect_mate_threat(result: EngineResult) -> Motif | None:
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
        # Attacked by lower-value piece and defenders <= attackers
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
        defended_squares = board.attacks(def_sq)
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
        between = chess.between(sq, target_sq)
        if not (board.occupied & between):
            king_sq_name = chess.square_name(enemy_king_sq)
            return Motif(
                label="back_rank",
                confidence=0.8,
                detail=f"Enemy king on {king_sq_name} is trapped on the back rank",
            )
    return None


def detect(
    board: chess.Board,
    best_move: chess.Move,
    result: EngineResult | None = None,
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

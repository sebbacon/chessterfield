from practice.modes import eligible_modes_for_game, eligible_modes_for_position
from progress.services import serialize_position_state


def position_to_dict(pos, *, user_state=None):
    state_payload = serialize_position_state(user_state)
    return {
        "id": pos.id,
        "name": pos.name,
        "fen": pos.fen,
        "notes": pos.notes,
        "created_at": pos.created_at.isoformat(),
        "tags": sorted(pos.tags.values_list("name", flat=True)),
        "source_kind": source_kind_from_value(pos.source),
        "user_state": state_payload,
        "score_summary": None if state_payload is None else {
            "best_score": state_payload["best_score"],
            "last_score": state_payload["last_score"],
            "mastery_score": state_payload["mastery_score"],
            "recent_accuracy_score": state_payload["recent_accuracy_score"],
            "current_perfect_streak": state_payload["current_perfect_streak"],
            "perfect_record": state_payload["perfect_record"],
            "needs_homework": state_payload["needs_homework"],
            "best_matched_prefix_plies": state_payload["best_matched_prefix_plies"],
            "last_matched_prefix_plies": state_payload["last_matched_prefix_plies"],
            "solved_count": state_payload["solved_count"],
            "attempt_count": state_payload["attempt_count"],
        },
        "eligible_modes": eligible_modes_for_position(),
    }


def game_result_label(game):
    if game.winner == "draw":
        return "Draw"
    if game.winner in {"white", "black"}:
        if game.winner == game.user_color:
            return "You won"
        return f"{game.opponent} won"
    if game.status == "aborted":
        return "Aborted"
    return "Result unavailable"


def game_winner_label(game):
    if game.winner == "draw":
        return "Draw"
    if game.winner == "white":
        return "White won"
    if game.winner == "black":
        return "Black won"
    return "Winner unknown"


def game_to_dict(game):
    return {
        "id": game.id,
        "name": game.name,
        "opponent": game.opponent,
        "fen": game.final_fen,
        "played_at": game.played_at.isoformat(),
        "user_color": game.user_color,
        "winner": game.winner,
        "winner_label": game_winner_label(game),
        "result_label": game_result_label(game),
        "status": game.status,
        "eligible_modes": eligible_modes_for_game(),
    }


def source_kind_from_value(source: str | None) -> str:
    if not source:
        return "manual"
    if source.startswith("puzzle-page:"):
        return "ocr"
    if source.startswith("lichess:"):
        return "lichess"
    return "other"

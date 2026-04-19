from django.utils import timezone

from positions.models import Position

from .models import PracticeAttempt, UserPositionState


def serialize_position_state(state: UserPositionState | None) -> dict | None:
    if state is None:
        return None
    return {
        "status": state.status,
        "viewed_at": state.viewed_at.isoformat() if state.viewed_at else None,
        "last_played_at": state.last_played_at.isoformat() if state.last_played_at else None,
        "completed_at": state.completed_at.isoformat() if state.completed_at else None,
        "mastery_score": state.mastery_score,
        "best_score": state.best_score,
        "last_score": state.last_score,
        "attempt_count": state.attempt_count,
    }


def get_position_state(user, position: Position) -> UserPositionState | None:
    if not user or not user.is_authenticated:
        return None
    return UserPositionState.objects.filter(user=user, position=position).first()


def get_or_create_position_state(user, position: Position) -> UserPositionState:
    state, _created = UserPositionState.objects.get_or_create(user=user, position=position)
    return state


def mark_position_viewed(user, position: Position) -> UserPositionState:
    state = get_or_create_position_state(user, position)
    if not state.viewed_at:
        state.viewed_at = timezone.now()
        state.save(update_fields=["viewed_at", "updated_at"])
    return state


def update_position_state(user, position: Position, payload: dict) -> UserPositionState:
    state = get_or_create_position_state(user, position)
    updated_fields = []

    if payload.get("viewed"):
        if not state.viewed_at:
            state.viewed_at = timezone.now()
            updated_fields.append("viewed_at")

    if "status" in payload and payload["status"] in UserPositionState.Status.values:
        state.status = payload["status"]
        updated_fields.append("status")
        if state.status in {UserPositionState.Status.COMPLETED, UserPositionState.Status.MASTERED}:
            state.completed_at = state.completed_at or timezone.now()
            updated_fields.append("completed_at")

    for field in ("mastery_score", "best_score", "last_score"):
        if field in payload:
            setattr(state, field, int(payload[field]))
            updated_fields.append(field)

    if payload.get("last_played"):
        state.last_played_at = timezone.now()
        updated_fields.append("last_played_at")

    if updated_fields:
        state.save(update_fields=sorted(set(updated_fields + ["updated_at"])))

    return state


def start_practice_attempt(*, user, position: Position, mode: str, metadata: dict | None = None) -> PracticeAttempt:
    state = get_or_create_position_state(user, position)
    now = timezone.now()
    state.last_played_at = now
    if not state.viewed_at:
        state.viewed_at = now
    if state.status == UserPositionState.Status.NEW:
        state.status = UserPositionState.Status.IN_PROGRESS
    state.save(update_fields=["last_played_at", "viewed_at", "status", "updated_at"])
    return PracticeAttempt.objects.create(
        user=user,
        position=position,
        mode=mode,
        metadata=metadata or {},
    )


def finish_practice_attempt(
    attempt: PracticeAttempt,
    *,
    result: str,
    score_delta: int = 0,
    metadata: dict | None = None,
) -> tuple[PracticeAttempt, UserPositionState]:
    now = timezone.now()
    attempt.result = result
    attempt.score_delta = score_delta
    attempt.finished_at = now
    if metadata is not None:
        attempt.metadata = metadata
    attempt.save(update_fields=["result", "score_delta", "finished_at", "metadata", "updated_at"])

    state = get_or_create_position_state(attempt.user, attempt.position)
    state.last_played_at = now
    state.attempt_count += 1
    state.last_score = score_delta
    state.best_score = max(state.best_score, score_delta)
    if not state.viewed_at:
        state.viewed_at = now
    if result in {PracticeAttempt.Result.WON, PracticeAttempt.Result.COMPLETED}:
        state.status = UserPositionState.Status.COMPLETED
        state.completed_at = state.completed_at or now
    elif state.status == UserPositionState.Status.NEW:
        state.status = UserPositionState.Status.IN_PROGRESS
    state.save(
        update_fields=[
            "last_played_at",
            "attempt_count",
            "last_score",
            "best_score",
            "viewed_at",
            "status",
            "completed_at",
            "updated_at",
        ]
    )
    return attempt, state


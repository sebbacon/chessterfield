from django.utils import timezone

from positions.models import Position

from .models import PracticeAttempt, UserPositionState

RECENT_ATTEMPT_WINDOW = 5
PERFECT_RECORD_MIN_ATTEMPTS = 3
HOMEWORK_MASTERY_THRESHOLD = 85


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
        "recent_accuracy_score": state.recent_accuracy_score,
        "current_perfect_streak": state.current_perfect_streak,
        "perfect_record": state.perfect_record,
        "needs_homework": state.needs_homework,
        "best_matched_prefix_plies": state.best_matched_prefix_plies,
        "last_matched_prefix_plies": state.last_matched_prefix_plies,
        "solved_count": state.solved_count,
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


def start_practice_attempt(
    *,
    user,
    position: Position,
    mode: str,
    metadata: dict | None = None,
    target_depth_plies: int = 4,
) -> PracticeAttempt:
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
        target_depth_plies=target_depth_plies,
        metadata=metadata or {},
    )


def finish_practice_attempt(
    attempt: PracticeAttempt,
    *,
    result: str,
    score_delta: int = 0,
    metadata: dict | None = None,
    matched_prefix_plies: int | None = None,
    expected_line: list[str] | None = None,
    played_line: list[str] | None = None,
    completion_reason: str = "",
    completed_normally: bool | None = None,
) -> tuple[PracticeAttempt, UserPositionState]:
    now = timezone.now()
    attempt.result = result
    attempt.score_delta = score_delta
    attempt.finished_at = now
    if matched_prefix_plies is not None:
        attempt.matched_prefix_plies = matched_prefix_plies
    if expected_line is not None:
        attempt.expected_line = expected_line
    if played_line is not None:
        attempt.played_line = played_line
    if completion_reason:
        attempt.completion_reason = completion_reason
    if completed_normally is not None:
        attempt.completed_normally = completed_normally
    if metadata is not None:
        attempt.metadata = metadata
    attempt.save(
        update_fields=[
            "result",
            "score_delta",
            "finished_at",
            "matched_prefix_plies",
            "expected_line",
            "played_line",
            "completion_reason",
            "completed_normally",
            "metadata",
            "updated_at",
        ]
    )

    state = get_or_create_position_state(attempt.user, attempt.position)
    state.last_played_at = now
    if not state.viewed_at:
        state.viewed_at = now
    apply_attempt_rollup(state)
    state.save(
        update_fields=[
            "last_played_at",
            "attempt_count",
            "mastery_score",
            "last_score",
            "best_score",
            "recent_accuracy_score",
            "current_perfect_streak",
            "perfect_record",
            "needs_homework",
            "last_matched_prefix_plies",
            "best_matched_prefix_plies",
            "solved_count",
            "viewed_at",
            "status",
            "completed_at",
            "updated_at",
        ]
    )
    return attempt, state


def apply_attempt_rollup(state: UserPositionState) -> None:
    attempts = list(
        PracticeAttempt.objects.filter(user=state.user, position=state.position)
        .exclude(result=PracticeAttempt.Result.ACTIVE)
        .order_by("-finished_at", "-started_at", "-id")
    )
    if not attempts:
        state.attempt_count = 0
        state.solved_count = 0
        state.best_score = 0
        state.last_score = 0
        state.recent_accuracy_score = 0
        state.current_perfect_streak = 0
        state.perfect_record = False
        state.needs_homework = True
        state.best_matched_prefix_plies = 0
        state.last_matched_prefix_plies = 0
        if state.status != UserPositionState.Status.NEW:
            state.status = UserPositionState.Status.IN_PROGRESS
        state.completed_at = None
        return

    latest_attempt = attempts[0]
    solved_attempts = [attempt for attempt in attempts if attempt_is_solved(attempt)]
    latest_solved_attempt = solved_attempts[0] if solved_attempts else None
    state.attempt_count = len(attempts)
    state.solved_count = len(solved_attempts)
    state.last_score = latest_attempt.score_delta
    state.best_score = max(attempt.score_delta for attempt in attempts)
    state.last_matched_prefix_plies = latest_attempt.matched_prefix_plies
    state.best_matched_prefix_plies = max(attempt.matched_prefix_plies for attempt in attempts)
    state.recent_accuracy_score = calculate_recent_accuracy_score(attempts[:RECENT_ATTEMPT_WINDOW])
    state.current_perfect_streak = calculate_current_perfect_streak(attempts)
    state.perfect_record = state.attempt_count >= PERFECT_RECORD_MIN_ATTEMPTS and state.solved_count == state.attempt_count
    state.mastery_score = calculate_mastery_score(
        attempt_count=state.attempt_count,
        solved_count=state.solved_count,
        recent_accuracy_score=state.recent_accuracy_score,
    )
    state.needs_homework = (
        not state.perfect_record
        and (state.attempt_count < PERFECT_RECORD_MIN_ATTEMPTS or state.mastery_score < HOMEWORK_MASTERY_THRESHOLD)
    )
    if state.perfect_record:
        state.status = UserPositionState.Status.MASTERED
        state.completed_at = state.completed_at or latest_solved_attempt.finished_at or timezone.now()
    elif state.solved_count > 0:
        state.status = UserPositionState.Status.COMPLETED
        state.completed_at = state.completed_at or latest_solved_attempt.finished_at or timezone.now()
    else:
        state.status = UserPositionState.Status.IN_PROGRESS
        state.completed_at = None


def attempt_is_solved(attempt: PracticeAttempt) -> bool:
    return (
        attempt.result == PracticeAttempt.Result.COMPLETED
        and attempt.matched_prefix_plies >= attempt.target_depth_plies
    )


def calculate_recent_accuracy_score(attempts: list[PracticeAttempt]) -> int:
    if not attempts:
        return 0
    normalized_scores = [
        min(attempt.matched_prefix_plies, attempt.target_depth_plies) / max(attempt.target_depth_plies, 1)
        for attempt in attempts
    ]
    return round(100 * sum(normalized_scores) / len(normalized_scores))


def calculate_current_perfect_streak(attempts: list[PracticeAttempt]) -> int:
    streak = 0
    for attempt in attempts:
        if not attempt_is_solved(attempt):
            break
        streak += 1
    return streak


def calculate_mastery_score(*, attempt_count: int, solved_count: int, recent_accuracy_score: int) -> int:
    if attempt_count <= 0:
        return 0
    solve_rate_score = round(100 * solved_count / attempt_count)
    confidence_score = round(100 * min(attempt_count, RECENT_ATTEMPT_WINDOW) / RECENT_ATTEMPT_WINDOW)
    mastery_score = (
        0.5 * recent_accuracy_score
        + 0.3 * solve_rate_score
        + 0.2 * confidence_score
    )
    return round(mastery_score)

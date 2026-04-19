import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from positions.models import Position
from progress.models import PracticeAttempt
from progress.services import finish_practice_attempt, start_practice_attempt

from .modes import PRACTICE_MODES


@require_http_methods(["GET"])
def practice_modes(request):
    return JsonResponse({"results": list(PRACTICE_MODES.values())})


@login_required
@require_http_methods(["POST"])
def attempts_list(request):
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    position_id = data.get("position_id")
    mode = data.get("mode", "classic")
    if mode not in PRACTICE_MODES:
        return JsonResponse({"error": "Unknown mode"}, status=400)
    target_depth_plies = max(1, int(data.get("target_depth_plies", 4)))

    position = get_object_or_404(Position, pk=position_id)
    attempt = start_practice_attempt(
        user=request.user,
        position=position,
        mode=mode,
        metadata=data.get("metadata"),
        target_depth_plies=target_depth_plies,
    )
    return JsonResponse(
        {
            "id": attempt.id,
            "mode": attempt.mode,
            "result": attempt.result,
            "started_at": attempt.started_at.isoformat(),
            "target_depth_plies": attempt.target_depth_plies,
        },
        status=201,
    )


@login_required
@require_http_methods(["PATCH"])
def attempt_detail(request, pk: int):
    attempt = get_object_or_404(PracticeAttempt, pk=pk, user=request.user)
    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    result = data.get("result")
    if result not in PracticeAttempt.Result.values:
        return JsonResponse({"error": "Invalid result"}, status=400)
    target_depth_plies = max(1, int(data.get("target_depth_plies", attempt.target_depth_plies)))
    matched_prefix_plies = max(0, int(data.get("matched_prefix_plies", 0)))
    expected_line = _normalize_line(data.get("expected_line"))
    played_line = _normalize_line(data.get("played_line"))

    attempt, state = finish_practice_attempt(
        attempt,
        result=result,
        score_delta=int(data.get("score_delta", matched_prefix_plies)),
        metadata=data.get("metadata"),
        target_depth_plies=target_depth_plies,
        matched_prefix_plies=matched_prefix_plies,
        expected_line=expected_line,
        played_line=played_line,
        completion_reason=str(data.get("completion_reason", "")).strip(),
        completed_normally=bool(data.get("completed_normally", False)),
    )
    return JsonResponse(
        {
            "attempt": {
                "id": attempt.id,
                "result": attempt.result,
                "score_delta": attempt.score_delta,
                "target_depth_plies": attempt.target_depth_plies,
                "matched_prefix_plies": attempt.matched_prefix_plies,
                "completion_reason": attempt.completion_reason,
                "completed_normally": attempt.completed_normally,
                "expected_line": attempt.expected_line,
                "played_line": attempt.played_line,
                "finished_at": attempt.finished_at.isoformat() if attempt.finished_at else None,
            },
            "user_state": {
                "status": state.status,
                "attempt_count": state.attempt_count,
                "best_score": state.best_score,
                "last_score": state.last_score,
                "mastery_score": state.mastery_score,
                "recent_accuracy_score": state.recent_accuracy_score,
                "current_perfect_streak": state.current_perfect_streak,
                "perfect_record": state.perfect_record,
                "needs_homework": state.needs_homework,
                "best_matched_prefix_plies": state.best_matched_prefix_plies,
                "last_matched_prefix_plies": state.last_matched_prefix_plies,
                "solved_count": state.solved_count,
            },
        }
    )


def _normalize_line(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]

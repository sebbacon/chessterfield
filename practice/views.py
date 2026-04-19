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

    position = get_object_or_404(Position, pk=position_id)
    attempt = start_practice_attempt(
        user=request.user,
        position=position,
        mode=mode,
        metadata=data.get("metadata"),
    )
    return JsonResponse(
        {
            "id": attempt.id,
            "mode": attempt.mode,
            "result": attempt.result,
            "started_at": attempt.started_at.isoformat(),
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

    attempt, state = finish_practice_attempt(
        attempt,
        result=result,
        score_delta=int(data.get("score_delta", 0)),
        metadata=data.get("metadata"),
    )
    return JsonResponse(
        {
            "attempt": {
                "id": attempt.id,
                "result": attempt.result,
                "score_delta": attempt.score_delta,
                "finished_at": attempt.finished_at.isoformat() if attempt.finished_at else None,
            },
            "user_state": {
                "status": state.status,
                "attempt_count": state.attempt_count,
                "best_score": state.best_score,
                "last_score": state.last_score,
            },
        }
    )

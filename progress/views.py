import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from positions.models import Position

from .services import get_position_state, serialize_position_state, update_position_state


@login_required
@require_http_methods(["GET", "PATCH"])
def position_state_detail(request, pk: int):
    position = get_object_or_404(Position, pk=pk)

    if request.method == "GET":
        return JsonResponse({"user_state": serialize_position_state(get_position_state(request.user, position))})

    try:
        data = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    state = update_position_state(request.user, position, data)
    return JsonResponse({"user_state": serialize_position_state(state)})

